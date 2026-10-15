import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect as tcpConnect } from "node:net";
import { createHash, createPublicKey } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeServer, listenLoopback } from "./lifecycle.mjs";

const execute = promisify(execFile);

export async function createAuthTls({ outputDir, workerPort }) {
  const directory = join(outputDir, "tls");
  await mkdir(directory, { recursive: true });
  const key = join(directory, "auth-key.pem");
  const certificate = join(directory, "auth-cert.pem");
  let tls;
  try {
    await execute("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", key, "-out", certificate, "-days", "1",
      "-subj", "/CN=auth.cqu.moe",
      "-addext", "subjectAltName=DNS:auth.cqu.moe",
    ]);
    const certPem = await readFile(certificate, "utf8");
    const spki = createPublicKey(certPem).export({ type: "spki", format: "der" });
    const spkiPin = createHash("sha256").update(spki).digest("base64");

    const keyPem = await readFile(key);
    const authorizationContracts = [];
    const observations = [];
    let successfulTokenExchanges = 0;
    tls = createHttpsServer({ key: keyPem, cert: certPem }, (fromClient, toClient) => {
      const requestUrl = new URL(fromClient.url ?? "/", "https://auth.cqu.moe");
      if (requestUrl.pathname === "/api/v1/auth/oauth2/authorize") {
        authorizationContracts.push({
          clientId: requestUrl.searchParams.get("client_id"),
          redirectUri: requestUrl.searchParams.get("redirect_uri"),
          responseType: requestUrl.searchParams.get("response_type"),
          challengeMethod: requestUrl.searchParams.get("code_challenge_method"),
          challenge: requestUrl.searchParams.get("code_challenge"),
          statePresent: Boolean(requestUrl.searchParams.get("state")),
        });
      }
      const headers = { ...fromClient.headers, host: "auth.cqu.moe", "accept-encoding": "identity" };
      const upstream = httpRequest({
        host: "127.0.0.1", port: workerPort, method: fromClient.method,
        path: fromClient.url, headers,
      }, response => {
        if (["/api/v1/auth/oauth2/authorize", "/api/v1/auth/sign-in/email", "/api/v1/auth/oauth2/consent", "/api/v1/auth/oauth2/token", "/api/v1/cqu/quicklogin/registrations"].includes(requestUrl.pathname)) {
          const redirect = response.headers.location ? new URL(response.headers.location, "https://auth.cqu.moe") : null;
          const observation = { method: fromClient.method, path: requestUrl.pathname, status: response.statusCode,
            oauthError: redirect?.searchParams.get("error") ?? null, codeIssued: Boolean(redirect?.searchParams.has("code")) };
          observations.push(observation);
          if (["/api/v1/auth/sign-in/email", "/api/v1/auth/oauth2/consent"].includes(requestUrl.pathname)) {
            observation.bodyEncoding = response.headers["content-encoding"] ?? "identity";
            let size = 0;
            let chunks = [];
            response.on("data", chunk => {
              size += chunk.length;
              if (size <= 65536) chunks.push(chunk);
              else chunks = [];
            });
            response.on("end", () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                observation.jsonParsed = true;
                if (body.redirect === true && typeof body.url === "string") {
                  const target = new URL(body.url);
                  observation.codeIssued = target.origin === "https://igfidegfgfoofnoncpmbcokbffjmmook.chromiumapp.org" && target.searchParams.has("code");
                }
              } catch { observation.jsonParsed = false; }
              finally { chunks = []; }
            });
          }
        }
        if (fromClient.method === "POST" && requestUrl.pathname === "/api/v1/auth/oauth2/token" && (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
          successfulTokenExchanges++;
        }
        toClient.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(toClient);
      });
      upstream.on("error", () => {
        toClient.writeHead(502, { "content-type": "text/plain" }).end("local auth unavailable");
        fromClient.destroy();
      });
      fromClient.pipe(upstream);
    });
    tls.on("tlsClientError", (_error, socket) => socket.destroy());
    await listenLoopback(tls);
    return {
      certificate,
      port: tls.address().port,
      spkiPin,
      readObservations: () => observations.slice(),
      assertOAuthContracts() {
        if (!authorizationContracts.length) throw new Error("Real OAuth authorization request was not observed");
        if (authorizationContracts.some(contract => contract.clientId !== "cqu-quicklogin-chrome" ||
            contract.responseType !== "code" || contract.challengeMethod !== "S256" ||
            typeof contract.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(contract.challenge) ||
            !contract.statePresent || typeof contract.redirectUri !== "string" || !contract.redirectUri.startsWith("https://"))) {
          throw new Error("OAuth authorization contract mismatch");
        }
        if (!authorizationContracts.some(contract => contract.redirectUri === "https://igfidegfgfoofnoncpmbcokbffjmmook.chromiumapp.org/")) {
          throw new Error("Official extension callback was not observed");
        }
        if (!successfulTokenExchanges) throw new Error("PKCE token exchange was not accepted by Auth");
        return {
          authorizationRequests: authorizationContracts.length,
          successfulTokenExchanges,
        };
      },
      async close() {
        await closeServer(tls);
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const cleanup = await Promise.allSettled([closeServer(tls)]);
    cleanup.push(...await Promise.allSettled([rm(directory, { recursive: true, force: true })]));
    const failures = cleanup.filter(result => result.status === "rejected");
    if (failures.length) {
      const failure = new AggregateError([error, ...failures.map(result => result.reason)], "TLS startup and cleanup both failed");
      failure.cleanupErrors = failures.map(result => result.reason);
      throw failure;
    }
    throw error;
  }
}

export async function createEgressProxy({ tlsPort }) {
  const denied = [];
  const proxy = createHttpServer();
  proxy.on("request", (request, response) => {
    const authority = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host;
    if (!authority || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(authority)) {
      denied.push(originOf(request.url ?? "unknown-http-request"));
      response.writeHead(403).end("unexpected browser egress denied");
      return;
    }
    const target = new URL(request.url ?? "/", `http://${authority}`);
    const headers = { ...request.headers };
    for (const header of ["proxy-connection", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) delete headers[header];
    const upstream = httpRequest(target, { method: request.method, headers }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      response.writeHead(502, { "content-type": "text/plain" }).end("local test app unavailable");
    });
    request.pipe(upstream);
  });
  proxy.on("connect", (request, clientSocket, head) => {
    if (request.url !== "auth.cqu.moe:443") {
      denied.push(originOf(`https://${request.url ?? "unknown-connect-target"}`));
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = tcpConnect(tlsPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => {
      clientSocket.destroy();
    });
    clientSocket.on("error", () => upstream.destroy());
  });
  await listenLoopback(proxy);
  return {
    port: proxy.address().port,
    denied,
    close: () => closeServer(proxy),
  };
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "invalid-denied-target";
  }
}

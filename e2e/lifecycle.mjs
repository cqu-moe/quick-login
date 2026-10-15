export function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    const failed = error => reject(error);
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", failed);
      resolve(server.address().port);
    });
  });
}

export async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}

export function failureMessage(error) {
  if (error instanceof AggregateError) return `${error.message}: ${error.errors.map(failureMessage).join("; ")}`;
  return error instanceof Error ? error.message : String(error);
}

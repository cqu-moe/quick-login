import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 0);
const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/plain" }).end("ok"));
server.listen(port, "127.0.0.1", () => {
  console.log(server.address().port);
});

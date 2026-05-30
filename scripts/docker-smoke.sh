#!/usr/bin/env bash
set -euo pipefail

image_tag="${INSCHNEIDERGRAM_DOCKER_IMAGE:-inschneidergram:smoke}"
api_key="docker-smoke-api-key-12345"
webhook_secret="docker-smoke-webhook-secret-12345"
container_id=""
temp_dir="$(mktemp -d)"

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT

port="$(node - <<'NODE'
const net = require("node:net");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate a local port");
  }
  console.log(address.port);
  server.close();
});
NODE
)"
base_url="http://127.0.0.1:${port}"

echo "==> docker build -t ${image_tag} ."
docker build -t "$image_tag" .

echo
echo "==> docker run ${image_tag}"
container_id="$(
  docker run -d --rm \
    -p "127.0.0.1:${port}:3107" \
    -v "${temp_dir}:/data" \
    -e INSCHNEIDERGRAM_PROVIDER=docker-smoke \
    -e INSCHNEIDERGRAM_API_KEY="$api_key" \
    -e INSCHNEIDERGRAM_WEBHOOK_SECRET="$webhook_secret" \
    -e INSCHNEIDERGRAM_ALLOWED_WEBHOOK_HOSTS=hooks.graphed.com \
    "$image_tag"
)"

node - "$base_url" <<'NODE'
const baseUrl = process.argv[2];
let lastError = "";

for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    if (response.ok && body.ok === true) {
      console.log(`Docker health OK: ${body.service} (${body.provider})`);
      process.exit(0);
    }
    lastError = `${response.status} ${JSON.stringify(body)}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

throw new Error(`Timed out waiting for Docker /health. Last error: ${lastError}`);
NODE

node - "$base_url" "$api_key" <<'NODE'
const [baseUrl, apiKey] = process.argv.slice(2);

async function readJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

const openapi = await readJson("/openapi.json");
if (!openapi.response.ok || typeof openapi.body?.paths !== "object") {
  throw new Error(`OpenAPI check failed: ${openapi.response.status} ${JSON.stringify(openapi.body)}`);
}

const protectedRoute = await readJson("/campaigns");
if (protectedRoute.response.status !== 401) {
  throw new Error(
    `Expected /campaigns to require API key, got ${protectedRoute.response.status}: ${JSON.stringify(
      protectedRoute.body
    )}`
  );
}

const launchPacket = await readJson("/pilot-launch-packet", {
  headers: {
    "x-api-key": apiKey
  }
});
if (
  !launchPacket.response.ok ||
  launchPacket.body?.routeMap?.createCampaign !== "/campaigns" ||
  !Array.isArray(launchPacket.body?.requiredExternalInputs)
) {
  throw new Error(
    `Launch packet check failed: ${launchPacket.response.status} ${JSON.stringify(launchPacket.body)}`
  );
}

console.log(
  JSON.stringify(
    {
      image: process.env.INSCHNEIDERGRAM_DOCKER_IMAGE ?? "inschneidergram:smoke",
      apiAuth: "enabled",
      openApiPathCount: Object.keys(openapi.body.paths).length,
      launchPacketInputs: launchPacket.body.requiredExternalInputs.length,
      dataVolume: "/data"
    },
    null,
    2
  )
);
NODE

echo
echo "Docker smoke passed."

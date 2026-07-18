const PUBLIC_HEALTH_BODY =
  '{"ok":true,"service":"blackspire-public","status":"up"}';

export function createPublicHealthResponse() {
  return new Response(PUBLIC_HEALTH_BODY, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

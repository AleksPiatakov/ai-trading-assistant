export async function GET(request: Request) {
  void request;
  return Response.json({ connected: false, message: "Підключення біржі вимкнено для навчального режиму." }, { status: 410 });
}

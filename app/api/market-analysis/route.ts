export async function GET(request: Request) {
  void request;
  return Response.json({ message: "Live-аналіз вимкнено: цей застосунок використовує лише локальні навчальні дані." }, { status: 410 });
}

export async function POST(request: Request) {
  void request;
  return Response.json({ message: "Підключення біржі вимкнено в навчальній версії. Ключі не приймаються і не зберігаються." }, { status: 410 });
}

import Link from "next/link";

export default function BybitConnection() {
  return <main className="min-h-screen bg-[#0d0d12] px-5 py-12 text-[#f4f2fa]"><div className="mx-auto max-w-xl rounded-2xl border border-[#2b2a38] bg-[#15151d] p-7"><Link className="text-sm text-[#c3b3ff]" href="/">← До AI Trading Assistant</Link><p className="mt-8 text-xs font-bold uppercase tracking-widest text-[#c3b3ff]">Навчальний режим</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Біржові підключення вимкнено</h1><p className="mt-3 text-sm leading-6 text-[#9895a8]">Ця версія не приймає API-ключі, не отримує котирування та не розміщує ордери. Усі елементи термінала є локальним навчальним прикладом.</p></div></main>;
}

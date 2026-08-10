export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 p-4">
      <h2 className="text-2xl font-bold mb-2">404 - الصفحة غير موجودة</h2>
      <p className="text-slate-400">عذراً، المورد الذي تطلبه غير موجود.</p>
    </div>
  );
}

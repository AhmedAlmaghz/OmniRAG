

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-md max-w-md text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-900">404 - الصفحة غير موجودة</h2>
        <p className="text-xs text-slate-500">المسار المطلوبة غير متاح حالياً.</p>
        <a
          href="/"
          className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition"
        >
          العودة للرئيسية
        </a>
      </div>
    </div>
  );
}

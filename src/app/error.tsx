'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8 text-center space-y-4">
      <h2 className="text-xl font-bold text-slate-100">حدث خطأ أثناء تحميل الصفحة</h2>
      <button
        onClick={() => reset()}
        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}

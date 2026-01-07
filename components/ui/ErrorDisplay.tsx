'use client';

interface ErrorDisplayProps {
  error: string;
  onRetry?: () => void;
}

export default function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md">
        <div className="text-red-600 text-5xl mb-4">⚠️</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops! Something went wrong</h2>
        <p className="text-gray-600 mb-6">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}

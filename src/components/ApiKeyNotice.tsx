export function ApiKeyNotice() {
  return (
    <div className="flex h-full items-center justify-center bg-[#fff8ec] p-8">
      <div className="max-w-md rounded-lg border border-[#f0d999] bg-white p-6 text-center shadow-sm">
        <p className="text-2xl">🔑</p>
        <h2 className="mt-2 text-base font-semibold text-[#111827]">OpenRouter API key missing</h2>
        <p className="mt-2 text-sm text-[#4b5563]">
          Add your key to a <code className="rounded bg-[#f3f4f6] px-1 py-0.5">.env</code> file at the project
          root as:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-[#111827] px-3 py-2 text-left text-xs text-[#e5e7eb]">
          VITE_OPENROUTER_API_KEY=your_key_here
        </pre>
        <p className="mt-2 text-xs text-[#6b7280]">
          Get a free key at{' '}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            openrouter.ai/keys
          </a>
          , then restart the dev server. See .env.example for reference.
        </p>
      </div>
    </div>
  );
}

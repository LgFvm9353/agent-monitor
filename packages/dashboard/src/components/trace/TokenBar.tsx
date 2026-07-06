/**
 * TokenBar — Token 使用分布条
 */

interface TokenBarProps {
  inputTokens: number;
  outputTokens: number;
  cacheHit?: number;
  maxTokens?: number;
}

export function TokenBar({ inputTokens, outputTokens, cacheHit = 0, maxTokens = 128000 }: TokenBarProps) {
  const total = inputTokens + outputTokens;
  const utilizationPercent = (total / maxTokens) * 100;

  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-muted-foreground">
        <span className="text-blue-600 font-mono">{inputTokens.toLocaleString()}</span>
        <span className="mx-1">+</span>
        <span className="text-purple-600 font-mono">{outputTokens.toLocaleString()}</span>
        {cacheHit > 0 && (
          <>
            <span className="mx-1 text-emerald-600">(cache: {cacheHit.toLocaleString()})</span>
          </>
        )}
        <span className="mx-1">=</span>
        <span className="font-mono font-semibold">{total.toLocaleString()}</span>
        <span className="ml-1">/ {maxTokens.toLocaleString()}</span>
      </div>

      {/* Token bar visualization */}
      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden min-w-[120px]">
        <div className="flex h-full">
          {cacheHit > 0 && (
            <div
              className="bg-green-500 transition-all"
              style={{ width: `${(cacheHit / maxTokens) * 100}%` }}
            />
          )}
          <div
            className="bg-blue-500 transition-all"
            style={{ width: `${(inputTokens / maxTokens) * 100}%` }}
          />
          <div
            className="bg-purple-500 transition-all"
            style={{ width: `${(outputTokens / maxTokens) * 100}%` }}
          />
        </div>
      </div>

      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {utilizationPercent.toFixed(1)}% used
      </div>
    </div>
  );
}

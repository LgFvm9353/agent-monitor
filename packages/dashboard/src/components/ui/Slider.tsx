import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  minLabel?: string;
  maxLabel?: string;
}

const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, label, minLabel, maxLabel, min = 0, max = 100, step, value, ...props }, ref) => {
    return (
      <div className={cn('space-y-1', className)}>
        {label && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-sm font-mono text-foreground">{value}</span>
          </div>
        )}
        <input
          type="range"
          ref={ref}
          min={min}
          max={max}
          step={step}
          value={value}
          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary"
          {...props}
        />
        {minLabel && maxLabel && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        )}
      </div>
    );
  },
);
Slider.displayName = 'Slider';

export { Slider };

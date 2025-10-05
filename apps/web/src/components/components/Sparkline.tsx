function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

export function Sparkline({
  values,
  height = 32,
  className,
  strokeClass = "bk-stroke-brand-blue",
  fillClass = "bk-fill-brand-blue/20"
}: {
  values: number[];
  height?: number;
  className?: string;
  strokeClass?: string;
  fillClass?: string;
}) {
  if (!values || values.length < 2) {
    return <div className={cx("bk-text-xs bk-text-brand-muted", className)}>–</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 100;
    return `${x},${y}`;
  });

  const areaPoints = [`0,100`, ...points, `100,100`].join(" ");
  const linePoints = points.join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cx("bk-w-full", className)}
      style={{ height }}
    >
      <polygon points={areaPoints} className={fillClass} />
      <polyline points={linePoints} className={cx("bk-fill-none bk-stroke-2", strokeClass)} />
    </svg>
  );
}

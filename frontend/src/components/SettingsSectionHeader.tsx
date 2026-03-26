export function SettingsSectionHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description: string;
  aside?: React.ReactNode;
}) {
  return (
    <div data-testid="settings-section-header" className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

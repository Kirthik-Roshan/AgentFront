export type StatusTone = "success" | "progress" | "warning" | "danger" | "neutral";

export const statusLabel: Record<StatusTone, string> = {
  success: "Healthy",
  progress: "In progress",
  warning: "Needs attention",
  danger: "Failed",
  neutral: "Not started",
};

export const cx = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(" ");

export const formatInr = (value: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export const formatCompact = (value: number): string =>
  new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);

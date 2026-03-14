import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div className={["rounded-md border border-gray-300 bg-white", className].join(" ")} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...props }: CardProps) {
  return (
    <div className={["flex items-start justify-between gap-4 p-6 pb-0", className].join(" ")} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className = "", children, ...props }: CardProps) {
  return (
    <h3 className={["text-md font-semibold text-[#6d28d9]", className].join(" ")} {...props}>
      {children}
    </h3>
  );
}

export function CardContent({ className = "", children, ...props }: CardProps) {
  return (
    <div className={["p-6", className].join(" ")} {...props}>
      {children}
    </div>
  );
}

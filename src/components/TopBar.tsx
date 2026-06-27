import { type ReactNode } from "react";
import { Wordmark } from "./Wordmark";

export function TopBar({ right }: { right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-void/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
        <Wordmark />
        {right}
      </div>
    </header>
  );
}

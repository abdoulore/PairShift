import { useEffect, useRef, useState } from "react";

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function usePoll(fn: () => void, ms: number, deps: unknown[] = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}

/** Anonymous id for paper switches made without a wallet (kept in this browser only). */
export function guestId(): string {
  try {
    let id = localStorage.getItem("tandem.guest");
    if (!id) {
      id = `guest:${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("tandem.guest", id);
    }
    return id;
  } catch {
    return "guest:anonymous";
  }
}

/** Adds "in" to every `.reveal` element inside the page as it scrolls into view. */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".reveal:not(.in)")];
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

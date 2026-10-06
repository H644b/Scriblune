// Browser fixture only; production uses Next's real navigation state.
export function usePathname() {
  return location.pathname;
}

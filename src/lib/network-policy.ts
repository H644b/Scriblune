export const VPN_BLOCKED = "VPN_BLOCKED";
export const VPN_BLOCKED_PATH = "/network-access";
export const VPN_BLOCKED_EVENT = "scriblune:network-blocked";
export const VPN_MESSAGE =
  "This connection was identified as a VPN. Disconnect the VPN and check again before signing in. Detection can be mistaken; contact support if this looks wrong.";
export function isVpnBlocked(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === VPN_BLOCKED
  );
}
export function signInDestination(error: unknown, otherwise: string) {
  return isVpnBlocked(error) ? VPN_BLOCKED_PATH : otherwise;
}
export function notifyVpnBlocked(value: unknown) {
  if (typeof window !== "undefined" && isVpnBlocked(value))
    window.dispatchEvent(new Event(VPN_BLOCKED_EVENT));
}
export function monitoredNetworkPath(path: string) {
  return (
    /^\/(desk|study|quiz|feedback|admin|account|checkout)(\/|$)/.test(path) &&
    path !== "/account/recovery"
  );
}

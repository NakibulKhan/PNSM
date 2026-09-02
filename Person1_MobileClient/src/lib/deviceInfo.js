import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { App } from "@capacitor/app";

/**
 * Device fields the backend forwards to Person 4's AI service on every
 * check-in (blueprint FR-05 contract, api-contract.md's `device` object).
 * A field left out here is a check Person 4's service cannot make, so this
 * is a hard requirement, not best-effort telemetry.
 *
 * `is_emulator` uses @capacitor/device's own `isVirtual` flag — already a
 * project dependency, no extra native plugin needed.
 *
 * `is_rooted` has NO implementation here. There is no root/jailbreak
 * detection plugin in this project's dependencies, and adding one needs a
 * real native build to actually test (out of scope for local dev-complete,
 * per ROADMAP.md Phase 3's explicit native-build exclusions). Sending
 * `false` unconditionally would be indistinguishable from "checked, and the
 * device is clean" — which is exactly the kind of silent-failure-that-looks-
 * like-success this codebase's other honesty-first modules (mockLocation.js)
 * deliberately avoid. `checked: false` on the return value keeps that
 * distinction visible to the caller; only the wire payload itself is
 * constrained to the boolean the contract requires.
 */
export async function getDeviceInfo() {
  const platform = Capacitor.getPlatform();

  if (platform === "web") {
    return {
      platform: "web",
      os_version: "",
      app_version: "",
      is_emulator: false,
      is_rooted: false,
      checked: { is_emulator: false, is_rooted: false },
    };
  }

  let osVersion = "";
  let isVirtual = false;
  try {
    const info = await Device.getInfo();
    osVersion = info?.osVersion ?? "";
    isVirtual = Boolean(info?.isVirtual);
  } catch {
    // Native call failed — fail closed on emulator detection the same way
    // mockLocation.js fails closed on spoofing: an unknown state on a real
    // device is treated as suspicious, not waved through.
    isVirtual = true;
  }

  let appVersion = "";
  try {
    const info = await App.getInfo();
    appVersion = info?.version ?? "";
  } catch {
    /* not fatal — app_version is audit-log context, not a security gate */
  }

  return {
    platform,
    os_version: osVersion,
    app_version: appVersion,
    is_emulator: isVirtual,
    is_rooted: false,
    checked: { is_emulator: true, is_rooted: false },
  };
}

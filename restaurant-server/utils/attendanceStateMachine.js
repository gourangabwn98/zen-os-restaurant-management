// utils/attendanceStateMachine.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for employee attendance/presence transitions —
// mirrors orderStateMachine.js's shape and role. Never hardcode "ONLINE" /
// "BREAK" / "OFFLINE" / "OPEN" / "CLOSED" elsewhere; import these.
//
//   (no session) → ONLINE (OPEN) ⇄ BREAK (OPEN) → OFFLINE (CLOSED)
//
// Session lifecycle (`status`) and presence (`presenceStatus`) are tracked
// separately on AttendanceSession (config/getModels.js) — `status` drives
// the "one active session per employee" unique index, `presenceStatus`
// drives the UI. OFFLINE only ever occurs together with CLOSED.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_STATUSES  = ["OPEN", "CLOSED"];
export const PRESENCE_STATUSES = ["ONLINE", "BREAK", "OFFLINE"];

const guardError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

/** Throws unless there is currently no open session for this employee. */
export const assertCanStartDuty = (existingOpenSession) => {
  if (existingOpenSession) {
    throw guardError("Duty is already active for this employee", 409);
  }
};

/** Throws unless the open session is currently ONLINE (not already on break). */
export const assertCanStartBreak = (session) => {
  if (!session || session.status !== "OPEN") {
    throw guardError("No active duty session to start a break on", 409);
  }
  if (session.presenceStatus === "BREAK") {
    throw guardError("Already on break", 409);
  }
};

/** Throws unless the open session is currently on BREAK. */
export const assertCanEndBreak = (session) => {
  if (!session || session.status !== "OPEN") {
    throw guardError("No active duty session to resume from break on", 409);
  }
  if (session.presenceStatus !== "BREAK") {
    throw guardError("Not currently on break", 409);
  }
};

/** Throws unless there is an open session to end. */
export const assertCanEndDuty = (session) => {
  if (!session || session.status !== "OPEN") {
    throw guardError("No active duty session to end", 409);
  }
};

// Wraps a handler so it only runs if `hasPermission` is true.
// Otherwise it shows a lightweight "no access" notice, consistent with
// the alert() pattern already used across this app for errors/status.
export function guardAction(hasPermission, fn, message = "You don't have permission to perform this action.") {
  return (...args) => {
    if (!hasPermission) {
      alert(message);
      return;
    }
    return fn(...args);
  };
}
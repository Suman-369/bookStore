/** In-memory set of online user IDs (from socket connect/disconnect). */
const onlineUsers = new Set();

export function add(userId) {
  const id = String(userId);
  onlineUsers.add(id);
}

export function remove(userId) {
  const id = String(userId);
  onlineUsers.delete(id);
}

export function has(userId) {
  return onlineUsers.has(String(userId));
}

/** @param {string[]} ids - user ids to check
 *  @returns {{ [id: string]: boolean }} */
export function getStatus(ids) {
  const out = {};
  for (const id of ids || []) {
    out[String(id)] = onlineUsers.has(String(id));
  }
  return out;
}

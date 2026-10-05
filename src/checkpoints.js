// Persist before clicking send so a process crash cannot turn an uncertain
// submission into a fresh question. Stored only in the local database.
export function saveCheckpoint(db, runId, job, state) {
  db.prepare('INSERT OR REPLACE INTO submission_checkpoints(run_id,question_id,account_id,state_json) VALUES(?,?,?,?)')
    .run(runId, job.question_id, job.account_id, JSON.stringify(state));
}

export function loadCheckpoint(db, runId, job) {
  const row = db.prepare('SELECT state_json FROM submission_checkpoints WHERE run_id=? AND question_id=? AND account_id=?')
    .get(runId, job.question_id, job.account_id);
  return row ? JSON.parse(row.state_json) : null;
}

export function clearCheckpoint(db, runId, job) {
  db.prepare('DELETE FROM submission_checkpoints WHERE run_id=? AND question_id=? AND account_id=?')
    .run(runId, job.question_id, job.account_id);
}

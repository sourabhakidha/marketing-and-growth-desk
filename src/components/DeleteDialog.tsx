import { useEffect, useState } from "react";
import { ErrorText, Field } from "./Form.tsx";
import { Modal } from "./Modal.tsx";

/** Delete = move to the Recycle Bin (D-035): restorable by an admin; needs a reason. */
export function MoveToBinDialog({ open, onClose, onConfirm, busy, error, what, refText }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; busy: boolean; error: unknown; what: "task" | "deliverable" | "goal"; refText: string;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Modal title={`Delete ${what} “${refText}”`} open={open} onClose={onClose}>
      <div className="stack">
        <p className="small muted">
          The {what} moves to the <strong>Recycle Bin</strong> and disappears from every view. An admin can restore it from the Bin.
          {what === "goal" ? " Its deliverables and tasks stay on the desk." : what === "deliverable" ? " Its tasks stay on the desk." : ""}
        </p>
        <Field label="Reason" required><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate of another task" /></Field>
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>Keep it</button>
          <button type="button" className="button button--danger" disabled={!reason.trim() || busy} onClick={() => onConfirm(reason.trim())}>
            {busy ? "Deleting…" : "Move to Recycle Bin"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Delete permanently = gone from the desk for good (the database keeps the record). Needs DELETE typed to confirm. */
export function PurgeDialog({ open, onClose, onConfirm, busy, error, what, refText }: {
  open: boolean; onClose: () => void; onConfirm: () => void; busy: boolean; error: unknown; what: "task" | "deliverable" | "goal"; refText: string;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) setTyped(""); }, [open]);
  return (
    <Modal title={`Delete ${what} “${refText}” permanently`} open={open} onClose={onClose}>
      <div className="stack">
        <div className="state state--error">
          <strong>This removes it from Marketing Desk for good.</strong>
          <span className="small"> It will no longer appear anywhere on the desk, including the Recycle Bin, and cannot be restored from here. The record is kept in the database and the activity log.</span>
        </div>
        <Field label="Type DELETE to confirm" required><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>Keep it</button>
          <button type="button" className="button button--danger" disabled={typed.trim().toUpperCase() !== "DELETE" || busy} onClick={onConfirm}>
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

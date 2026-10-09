import { useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Share2, X } from "lucide-react";
import {
  shareUrl,
  type CheckInsApi,
  type Share,
  type ShareExpiry,
} from "../checkinsApi";
import { toDateKey } from "../domain/dates";
import { longDate } from "./copy";

type ShareApi = Pick<CheckInsApi, "getShare" | "createShare" | "revokeShare">;

const EXPIRY_OPTIONS: { value: ShareExpiry; label: string }[] = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: null, label: "Até eu desativar" },
];

const day = (iso: string) => longDate(toDateKey(new Date(iso)));

/**
 * Um link só por conta: quem o recebe vê o resumo dos últimos 60 dias, sem
 * login e sem poder alterar nada. Gerar outro desativa o anterior. O link
 * completo só aparece logo depois de criado, porque o servidor guarda só o
 * hash dele.
 */
export function ShareDialog({
  open,
  onClose,
  api,
}: {
  open: boolean;
  onClose: () => void;
  api: ShareApi;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [share, setShare] = useState<Share | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "busy">("loading");
  const [error, setError] = useState("");
  const [expiry, setExpiry] = useState<ShareExpiry>(30);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setStatus("loading");
    setError("");
    setLink(null);
    setConfirm(null);
    api.getShare().then(
      (current) => {
        if (!active) return;
        setShare(current);
        setStatus("ready");
      },
      () => {
        if (!active) return;
        setError("Não foi possível ver seu link agora. Tente de novo.");
        setStatus("ready");
      },
    );
    return () => {
      active = false;
    };
  }, [open, api]);

  const create = async () => {
    setStatus("busy");
    setError("");
    setConfirm(null);
    try {
      const created = await api.createShare(expiry);
      setShare(created.share);
      setLink(shareUrl(window.location.origin, created.token));
      setCopied(false);
    } catch {
      setError("Não foi possível gerar o link. Tente de novo.");
    } finally {
      setStatus("ready");
    }
  };

  const revoke = async () => {
    setStatus("busy");
    setError("");
    setConfirm(null);
    try {
      await api.revokeShare();
      setShare(null);
      setLink(null);
    } catch {
      setError("Não foi possível desativar o link. Tente de novo.");
    } finally {
      setStatus("ready");
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Não deu para copiar. Selecione o link e copie.");
    }
  };

  const send = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: "Meus sentimentos no Energy Me", url: link });
    } catch {
      // Cancelado por quem compartilha; nada a fazer.
    }
  };

  const busy = status === "busy";

  return (
    <dialog
      ref={ref}
      className="share-dialog"
      aria-labelledby="share-title"
      onClose={onClose}
    >
      <div className="share-head">
        <h2 id="share-title">Compartilhar meus sentimentos</h2>
        <button
          className="share-close"
          type="button"
          aria-label="Fechar"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="share-lead">
        Quem abrir o link vê seu resumo dos últimos 60 dias, sem entrar na
        conta e sem poder alterar nada. Seu nome e e-mail não aparecem.
      </p>

      {status === "loading" ? (
        <p className="share-state" role="status">
          <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" />
          Carregando...
        </p>
      ) : (
        <>
          {link ? (
            <div className="share-link">
              <input
                type="text"
                readOnly
                value={link}
                aria-label="Link para compartilhar"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="share-actions">
                <button className="cta" type="button" onClick={copy}>
                  {copied ? (
                    <Check size={18} aria-hidden="true" />
                  ) : (
                    <Copy size={18} aria-hidden="true" />
                  )}
                  {copied ? "Copiado" : "Copiar link"}
                </button>
                {"share" in navigator ? (
                  <button className="share-secondary" type="button" onClick={send}>
                    <Share2 size={18} aria-hidden="true" />
                    Enviar
                  </button>
                ) : null}
              </div>
              <p className="share-hint">
                Guarde ou envie agora: por segurança, o link completo só
                aparece desta vez.
              </p>
            </div>
          ) : null}

          {share ? (
            <p className="share-state">
              Link ativo desde {day(share.createdAt)}
              {share.expiresAt
                ? `, vale até ${day(share.expiresAt)}.`
                : ", vale até você desativar."}
            </p>
          ) : (
            <p className="share-state">Nenhum link ativo.</p>
          )}

          <fieldset className="share-expiry" disabled={busy}>
            <legend>{share ? "Validade do novo link" : "Validade"}</legend>
            {EXPIRY_OPTIONS.map((o) => (
              <label key={String(o.value)}>
                <input
                  type="radio"
                  name="share-expiry"
                  checked={expiry === o.value}
                  onChange={() => setExpiry(o.value)}
                />
                {o.label}
              </label>
            ))}
          </fieldset>

          {confirm === "replace" ? (
            <div className="share-confirm">
              <span>O link atual vai parar de funcionar. Gerar outro?</span>
              <button className="link" type="button" onClick={create}>
                Gerar
              </button>
              <button className="link" type="button" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          ) : confirm === "revoke" ? (
            <div className="share-confirm">
              <span>Quem tem o link deixa de ver na hora. Desativar?</span>
              <button className="link danger" type="button" onClick={revoke}>
                Desativar
              </button>
              <button className="link" type="button" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <div className="share-actions">
              <button
                className={link ? "share-secondary" : "cta"}
                type="button"
                disabled={busy}
                onClick={share ? () => setConfirm("replace") : create}
              >
                {busy ? (
                  <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" />
                ) : null}
                {share ? "Gerar novo link" : "Gerar link"}
              </button>
              {share ? (
                <button
                  className="link danger"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm("revoke")}
                >
                  Desativar link
                </button>
              ) : null}
            </div>
          )}
        </>
      )}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </dialog>
  );
}

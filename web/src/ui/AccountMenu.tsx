import { Cloud, LoaderCircle, LogOut, Share2, Smartphone } from "lucide-react";

/**
 * Conta no canto do cabeçalho: um avatar que abre um menu curto com quem
 * está conectado, onde os dados ficam e o botão de sair. Sair fica a dois
 * toques para não acontecer sem querer.
 */
export function AccountMenu({
  name,
  email,
  remote,
  busy,
  onShare,
  onSignOut,
}: {
  name: string;
  email?: string;
  remote: boolean;
  busy: boolean;
  /** Só com os dados na nuvem: o link lê da API. */
  onShare?: () => void;
  onSignOut: () => void;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <>
      <button
        className="account-avatar"
        type="button"
        popoverTarget="account-menu"
        aria-label={`Minha conta: ${name}`}
        title={email ?? name}
      >
        {busy ? (
          <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </button>
      <div id="account-menu" className="account-menu" popover="auto">
        <div className="account-who">
          <strong>{name}</strong>
          {email && email !== name ? <span>{email}</span> : null}
        </div>
        <p className="account-storage">
          {remote ? (
            <Cloud size={16} aria-hidden="true" />
          ) : (
            <Smartphone size={16} aria-hidden="true" />
          )}
          {remote ? "Check-ins salvos na nuvem" : "Check-ins salvos neste aparelho"}
        </p>
        {onShare ? (
          <button
            className="account-item"
            type="button"
            popoverTarget="account-menu"
            popoverTargetAction="hide"
            onClick={onShare}
          >
            <Share2 size={18} aria-hidden="true" />
            Compartilhar meus sentimentos
          </button>
        ) : null}
        <button
          className="account-signout"
          type="button"
          onClick={onSignOut}
          disabled={busy}
        >
          <LogOut size={18} aria-hidden="true" />
          Sair da conta
        </button>
      </div>
    </>
  );
}

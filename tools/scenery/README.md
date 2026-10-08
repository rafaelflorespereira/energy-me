# Cenários do resumo

Gerador procedural das 7 cenas animadas do resumo (uma por sentimento). O código é a fonte dos arquivos em [`web/public/scenery`](../../web/public/scenery): não há imagens de terceiros nem serviço externo envolvido.

| Sentimento | Elemento | Cena |
| --- | --- | --- |
| alegria | Fogo | campo ensolarado com papoulas e borboletas, pessoa de braços abertos |
| tristeza | Metal | lago na chuva, salgueiro-chorão, pessoa sentada no deque |
| raiva | Madeira | vento forte e horizonte em brasa sob a tempestade |
| frustração | Madeira | estrada que termina numa porteira fechada, rajadas que morrem |
| preocupação | Terra | caminho entre o trigo que some na névoa ocre |
| culpa | Água | subida na neve carregando um fardo, uma janela acesa ao longe |
| medo | Água | mar escuro à noite, lua encoberta, alguém pequeno na areia |

Cada cena sai em duas versões: `mobile` (retrato, 780×1688) e `desktop` (paisagem, 1600×900). Para cada uma: `.webp` (imagem estática completa), `.webm` (VP9) e `.mp4` (H.264), mudos, em loop perfeito de 4 s a 24 fps. As cenas são desenhadas na intensidade 4; o app aplica a intensidade de hoje com cor e velocidade.

## Gerar

Requer Python 3.11+, `numpy`, `scipy`, `Pillow` e `ffmpeg` com `libvpx-vp9` e `libx264`.

```bash
cd tools/scenery
python3 scenery.py --still               # frames PNG em _preview/ para revisar (rápido)
python3 scenery.py                       # renderiza tudo e codifica para web/public/scenery
python3 scenery.py alegria medo          # só algumas cenas
python3 scenery.py --variant mobile      # só uma versão
python3 scenery.py --encode-only         # recodifica a partir dos masters em _master/
```

A renderização guarda um master sem perdas em `_master/` (fora do Git); ajustar qualidade ou tamanho dos vídeos é só mudar `CRF_VP9` / `CRF_H264` e rodar `--encode-only`. Depois de gerar de novo, aumente `SCENERY_VERSION` em `web/src/ui/scenery.ts`.

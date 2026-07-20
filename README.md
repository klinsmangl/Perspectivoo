# ET-RDG → SLD (GeoServer) — Pipeline e entregáveis

## O que eu descobri no PDF

- **238 páginas**, texto real (não escaneado) — `pdftotext`/`pdfplumber` funcionam.
- Os **pictogramas dos símbolos são desenhos vetoriais** dentro do próprio PDF
  (linhas, curvas, retângulos via `PyMuPDF.page.get_drawings()`), não imagens
  raster. Isso significa que dá pra extrair a geometria de cada símbolo por
  código, mas cada um é um **desenho composto** (várias primitivas por
  símbolo — ex.: o Aerogerador tem torre + 3 pás + círculo de base), então
  não existe uma extração 100% automática para "isso é um triângulo" —
  precisa de classificação visual (feita por mim, olhando cada página
  renderizada) ou de um classificador geométrico mais elaborado.
- **Anexo C (Cores)** e **Anexo D (Padrões de preenchimento)** são
  **texto limpo e tabular** → extração 100% automática, sem revisão manual.
  Já processei os dois por completo (22 cores, 24 padrões de preenchimento).
- O catálogo de símbolos (Anexo A, 20 categorias, ~300 classes) segue sempre
  a mesma estrutura textual (Classe / Código / Geometria / Condição / Cor /
  Estilo / Peso), então o *metadado* de cada classe é extraível
  automaticamente — só o *desenho do símbolo em si* precisa de revisão
  visual.

## Arquivos entregues nesta rodada

| Arquivo | Status | Conteúdo |
|---|---|---|
| `calibration.py` | ✅ completo | Funções de conversão mm→px calibradas (não é `mm*3.78`) para peso de linha, símbolo pontual e tile de preenchimento |
| `colors.json` | ✅ completo | As 22 cores do Anexo C (nome → hex) |
| `anexoD.txt` / `gen_fill_patterns.py` | ✅ completo | Parser + gerador SLD para os **24 padrões de preenchimento** do Anexo D (100% automatizado) |
| `out/fill_patterns.json` | ✅ completo | Os 24 padrões estruturados (tile, primitivas, cor, tamanho) |
| `out/fill_patterns.sld.xml` | ✅ completo | Blocos `PolygonSymbolizer` prontos, um por padrão (PAD-10 a PAD-40) |
| `a1_energia_comunicacoes.json` | ✅ exemplo trabalhado | As 16 classes da categoria **A.1 Energia e Comunicações**, com `simplified_mark` curado visualmente |
| `out/a1_energia_comunicacoes.sld` | ✅ exemplo trabalhado | SLD válido gerado a partir do JSON acima (13 regras) |

## Sobre a simplificação de marcas

Segui exatamente a ideia que você propôs: em vez de `ExternalGraphic` com
SVG, uso `WellKnownName` (`circle`, `triangle`, `square`, `cross`, `x`) e
extensões do GeoServer (`shape://vertline`, `shape://slash`,
`shape://times`, etc). Quando o símbolo original é composto (a maioria dos
pictogramas pontuais da ET-RDG é), a técnica usada é **empilhar múltiplos
`PointSymbolizer` na mesma `Rule`** — o GeoServer renderiza na ordem declarada,
então dá pra simular "círculo + triângulo por cima" etc. Isso preserva a
leitura geral do símbolo sem tentar reproduzir o desenho exato.

Marquei em cada caso um campo `fidelidade_original` (ALTA/MÉDIA/BAIXA) —
linhas (Trecho_Comunic, Trecho_Energia) e padrões de preenchimento
convertem com fidelidade alta; símbolos pontuais compostos (Aerogerador,
Torre_Energia) são aproximações e vale revisar visualmente antes de ir
para produção.

## O que falta (escopo real)

A ET-RDG tem **20 categorias no Anexo A** (Energia e Comunicações é a
menor, com 16 classes) e mais **10 categorias no Anexo B** (símbolos
específicos para ortoimagem). No total isso é algo entre **250 e 350
classes**, cada uma com 1 a 4 casos. Fazer isso com a mesma qualidade da
amostra A.1 — metadado extraído + inspeção visual da página + mark
simplificado + nota de fidelidade — é viável, mas é um trabalho grande:
dá pra estimar ~1 categoria por rodada de trabalho, então é melhor eu
continuar **categoria por categoria**, e você vai validando o resultado
(pode ajustar o mapeamento de marcas conforme o gosto, por exemplo trocar
`triangle` por `shape://plus` em antenas).

**Sugestão de ordem** (categorias com mais classes primeiro, já que são as
que mais aparecem em mapas): Sistema de Transporte Rodoviário (A.13),
Hidrografia (A.3), Edificações (A.18), Relevo (A.6), depois as menores.

Quer que eu continue pela A.3 (Hidrografia) ou prefere escolher a ordem?

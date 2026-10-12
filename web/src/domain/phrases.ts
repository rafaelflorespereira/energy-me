// Frase do dia: uma frase acolhedora para o sentimento mais intenso do check-in.
// Dez frases por sentimento, escritas a partir da leitura da MTC de cada um.

import { type DateKey } from './dates'
import { type FeelingId } from './feelings'

export const PHRASES: Record<FeelingId, readonly string[]> = {
  raiva: [
    'A raiva mostra onde um limite foi tocado. Escute o recado antes de agir.',
    'Respire fundo e solte o ar devagar: a energia do Fígado pede movimento, não explosão.',
    'Você pode sentir raiva e ainda escolher com calma o próximo passo.',
    'Uma caminhada curta ajuda a raiva a circular em vez de se acumular.',
    'Como a árvore no vento, você pode se dobrar sem se quebrar.',
    'Nomear a raiva já tira um pouco da força dela sobre você.',
    'Hoje vale dizer não com firmeza e gentileza ao mesmo tempo.',
    'A Madeira cresce para cima: transforme essa força em algo que você quer construir.',
    'Antes de responder, dê a si mesmo o tempo de três respirações.',
    'A raiva passa. O que você faz com ela é o que fica.',
  ],
  frustracao: [
    'Nem tudo saiu como você queria, e tudo bem recomeçar por um passo menor.',
    'A frustração é energia parada. Mexa o corpo e deixe ela fluir.',
    'Você fez o que foi possível com o que tinha hoje.',
    'Às vezes o caminho desvia para que você encontre outro jeito de chegar.',
    'Troque o "deveria" por "o que posso fazer agora?".',
    'A Madeira precisa de espaço para crescer: abra espaço na sua agenda e na sua cabeça.',
    'Um pequeno avanço ainda é avanço.',
    'Seja paciente com você como seria com um amigo querido.',
    'Alongue os ombros e solte a mandíbula: a frustração costuma morar aí.',
    'O que hoje trava pode destravar amanhã com olhos descansados.',
  ],
  preocupacao: [
    'Volte para o agora: este momento é o único que você precisa resolver.',
    'Pensar em círculos cansa o Baço. Anote o que preocupa e deixe o papel guardar por você.',
    'Coma com calma hoje: a Terra se fortalece quando você se nutre com presença.',
    'Nem toda preocupação precisa de resposta hoje.',
    'Pergunte-se: o que está nas minhas mãos agora? Comece só por isso.',
    'Pés no chão, respiração lenta. A Terra sustenta você.',
    'Você já atravessou dias incertos antes e encontrou um caminho.',
    'Cuidar de si também é cuidar de quem você se preocupa.',
    'Troque o "e se der errado?" por "e se der certo?".',
    'Uma coisa de cada vez é o ritmo mais seguro.',
  ],
  alegria: [
    'Aproveite essa luz e deixe ela aquecer o seu dia inteiro.',
    'A alegria cresce quando é compartilhada. Conte algo bom a alguém.',
    'Guarde na memória este momento: ele é um recurso para os dias difíceis.',
    'O Fogo do Coração brilha melhor quando é calmo e constante.',
    'Agradeça por algo pequeno hoje. Isso multiplica o que já está bom.',
    'Que essa leveza acompanhe você nas próximas horas.',
    'Celebrar não precisa de motivo grande: o dia de hoje já basta.',
    'Sorrir é contagioso. Espalhe um pouco por aí.',
    'Alegria com serenidade nutre o Coração sem cansá-lo.',
    'Você merece se sentir assim. Receba esse momento por inteiro.',
  ],
  tristeza: [
    'A tristeza também é uma forma de cuidado. Permita-se sentir sem pressa.',
    'Respire fundo pelo nariz: o Pulmão gosta de ar novo e espaço no peito.',
    'Você não precisa estar bem o tempo todo.',
    'Como o outono, este momento é de soltar o que já cumpriu seu tempo.',
    'Chorar alivia. Não há nada de fraco nisso.',
    'Procure alguém de confiança: tristeza dividida pesa menos.',
    'Seja gentil consigo hoje, como seria com quem você ama.',
    'Depois do outono vem a primavera. Os ciclos se renovam.',
    'Um gesto simples de autocuidado já é suficiente hoje.',
    'Deixar ir abre espaço para o que ainda vai chegar.',
  ],
  culpa: [
    'Você é mais do que o seu erro. Aprenda com ele e siga em frente.',
    'Assuma o que é seu e devolva o que não é.',
    'Pedir desculpas, inclusive a si mesmo, é um ato de coragem.',
    'A culpa ensina, mas não precisa morar em você.',
    'Você fez o melhor que podia com o que sabia naquele momento.',
    'Como a Água, deixe fluir o que já passou e siga o curso.',
    'Trate a si mesmo com a mesma compreensão que daria a alguém que você ama.',
    'Reparar é possível. Ficar se punindo não ajuda ninguém.',
    'Descanse: o Rim recupera força quando você se permite pausar.',
    'Hoje é uma nova chance de agir de acordo com o que você acredita.',
  ],
  medo: [
    'O medo avisa, mas não precisa decidir por você.',
    'Respire devagar e sinta os pés no chão: neste momento, há chão firme sob você.',
    'Coragem é dar um pequeno passo mesmo com medo.',
    'Como a Água, você pode contornar o obstáculo em vez de enfrentá-lo de frente.',
    'Aqueça o corpo e descanse bem: o Rim se fortalece com calor e repouso.',
    'Divida o que assusta em partes menores. Cada parte é possível.',
    'Você já superou medos antes. Essa força ainda está em você.',
    'Fale sobre o que te assusta: o medo diminui quando ganha palavras.',
    'Não é preciso ter todas as respostas para seguir em frente.',
    'A Água é calma no fundo, mesmo quando a superfície se agita.',
  ],
}

/**
 * Frase do dia para um sentimento: muda de um dia para o outro, mas fica a mesma
 * durante o dia (mesma data e mesmo sentimento sempre dão a mesma frase).
 */
export function phraseOfTheDay(feeling: FeelingId, date: DateKey): string {
  const list = PHRASES[feeling]
  return list[hash(`${date}:${feeling}`) % list.length]
}

/** FNV-1a de 32 bits: simples, estável e igual em qualquer plataforma. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

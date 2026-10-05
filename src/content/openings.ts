// Opening lines ported from the prototype (content.js). Each move is [san, explanation]. All lines are verified legal.
import type { Color } from '@/chess/types';

export type OpeningMove = [san: string, explanation: string];

export interface OpeningLine {
  name: string;
  moves: OpeningMove[];
}

export interface OpeningSet {
  title: string;
  side: Color;
  blurb: string;
  lines: OpeningLine[];
}

export type OpeningKey = 'london' | 'italian' | 'vsE4' | 'vsD4';

export const OPENINGS: Record<OpeningKey, OpeningSet> = {
  "london": {
    "title": "London System",
    "side": "w",
    "blurb": "Your new White opening. d4, Bf4, e3, Nf3, c3, Bd3, Nbd2, castle. Same setup almost every game.",
    "lines": [
      {
        "name": "Main setup vs ...d5",
        "moves": [
          [
            "d4",
            "Take the center."
          ],
          [
            "d5",
            "Black takes the center too."
          ],
          [
            "Bf4",
            "Bishop out BEFORE e3, so it never gets locked in. This is the London."
          ],
          [
            "Nf6",
            "Black develops."
          ],
          [
            "e3",
            "Now e3 is safe: your bishop is already outside the pawn chain."
          ],
          [
            "e6",
            "Black opens a path for the dark bishop."
          ],
          [
            "Nf3",
            "Develop the knight."
          ],
          [
            "c5",
            "Black hits your d4 pawn."
          ],
          [
            "c3",
            "Pawn triangle c3, d4, e3. d4 is rock solid."
          ],
          [
            "Nc6",
            "More pressure on d4."
          ],
          [
            "Nbd2",
            "Knight to d2, keeping the c-pawn free."
          ],
          [
            "Bd6",
            "Black offers to trade bishops."
          ],
          [
            "Bg3",
            "Keep your best bishop. If Black takes, hxg3 opens your h-file."
          ],
          [
            "O-O",
            "Black castles."
          ],
          [
            "Bd3",
            "Bishop aims at h7. Castle next and your setup is complete."
          ]
        ]
      },
      {
        "name": "Black attacks b2 (...Qb6)",
        "moves": [
          [
            "d4",
            "Take the center."
          ],
          [
            "d5",
            "Black takes the center too."
          ],
          [
            "Bf4",
            "Bishop out first."
          ],
          [
            "c5",
            "Black hits d4 right away."
          ],
          [
            "e3",
            "Support d4."
          ],
          [
            "Nc6",
            "More pressure on d4."
          ],
          [
            "c3",
            "Pawn triangle. d4 is safe."
          ],
          [
            "Qb6",
            "The trick! Your bishop left c1, so b2 has no defender."
          ],
          [
            "Qb3",
            "Defend b2 and offer a queen trade."
          ],
          [
            "c4",
            "Black kicks your queen."
          ],
          [
            "Qc2",
            "The queen stays near b2."
          ],
          [
            "Bf5",
            "Black attacks your queen again."
          ],
          [
            "Qc1",
            "Back home, still guarding b2. Nothing is lost."
          ],
          [
            "e6",
            "Black develops."
          ],
          [
            "Nd2",
            "Back to normal development. Next: Ngf3, Be2, castle."
          ]
        ]
      },
      {
        "name": "Knight hunts your bishop (...Nh5)",
        "moves": [
          [
            "d4",
            "Take the center."
          ],
          [
            "d5",
            "Black takes the center too."
          ],
          [
            "Bf4",
            "Bishop out first."
          ],
          [
            "Nf6",
            "Black develops."
          ],
          [
            "e3",
            "Support d4."
          ],
          [
            "c5",
            "Black hits d4."
          ],
          [
            "c3",
            "Pawn triangle."
          ],
          [
            "Nc6",
            "Black develops."
          ],
          [
            "Nd2",
            "Knight to d2."
          ],
          [
            "e6",
            "Black opens the dark bishop."
          ],
          [
            "Ngf3",
            "Second knight out."
          ],
          [
            "Nh5",
            "The knight wants to grab your f4 bishop."
          ],
          [
            "Bg5",
            "Step away and hit the queen. Your bishop survives."
          ],
          [
            "Be7",
            "Black blocks."
          ],
          [
            "Bxe7",
            "Trade on your terms."
          ],
          [
            "Qxe7",
            "Black recaptures."
          ],
          [
            "Bd3",
            "Black's knight on h5 is now stuck on the edge. Castle next."
          ]
        ]
      },
      {
        "name": "Black offers the bishop trade (...Bd6)",
        "moves": [
          [
            "d4",
            "Take the center."
          ],
          [
            "d5",
            "Black takes the center too."
          ],
          [
            "Bf4",
            "Bishop out first."
          ],
          [
            "Nf6",
            "Black develops."
          ],
          [
            "e3",
            "Support d4."
          ],
          [
            "e6",
            "Black opens the dark bishop."
          ],
          [
            "Nf3",
            "Develop."
          ],
          [
            "Bd6",
            "Black challenges your bishop."
          ],
          [
            "Bg3",
            "Keep it. If ...Bxg3, hxg3 opens the h-file for your rook."
          ],
          [
            "O-O",
            "Black castles."
          ],
          [
            "Bd3",
            "Aim at h7."
          ],
          [
            "c5",
            "Black hits d4."
          ],
          [
            "c3",
            "Pawn triangle."
          ],
          [
            "Nc6",
            "Black develops."
          ],
          [
            "Nbd2",
            "Setup almost done. Castle next."
          ]
        ]
      },
      {
        "name": "Black plays the King's Indian (...g6)",
        "moves": [
          [
            "d4",
            "Take the center."
          ],
          [
            "Nf6",
            "Black develops first."
          ],
          [
            "Bf4",
            "Same setup, no matter what."
          ],
          [
            "g6",
            "Black plans a fianchetto."
          ],
          [
            "e3",
            "Support d4."
          ],
          [
            "Bg7",
            "The bishop on g7 eyes your d4 and b2."
          ],
          [
            "Nf3",
            "Develop."
          ],
          [
            "O-O",
            "Black castles."
          ],
          [
            "Be2",
            "Against ...g6, Be2 is a calm spot for the bishop."
          ],
          [
            "d6",
            "Black prepares ...e5."
          ],
          [
            "h3",
            "A home for your bishop on h2 if Black pushes ...e5."
          ],
          [
            "c5",
            "Black hits d4."
          ],
          [
            "c3",
            "Pawn triangle. Castle next."
          ]
        ]
      }
    ]
  },
  "italian": {
    "title": "Italian Game",
    "side": "w",
    "blurb": "Your White opening. e4, Nf3, Bc4, castle. Same plan almost every game.",
    "lines": [
      {
        "name": "Main line",
        "moves": [
          [
            "e4",
            "Take the center. This opens lines for your queen and your light-squared bishop."
          ],
          [
            "e5",
            "Black takes the center too."
          ],
          [
            "Nf3",
            "Develop a knight toward the center and attack the e5 pawn."
          ],
          [
            "Nc6",
            "Black defends e5 by developing a knight."
          ],
          [
            "Bc4",
            "Put the bishop on its best diagonal. It aims at f7, the weakest point near Black's king."
          ],
          [
            "Bc5",
            "Black copies you. That bishop aims at your f2."
          ],
          [
            "c3",
            "A quiet move that prepares d4 later to grab more of the center."
          ],
          [
            "Nf6",
            "Black develops and attacks your e4 pawn."
          ],
          [
            "d3",
            "Protect e4 with a pawn. Solid and simple, and it opens your dark-squared bishop."
          ],
          [
            "d6",
            "Black protects e5 the same way."
          ],
          [
            "O-O",
            "Castle. Your king is tucked away and your rook joins the game."
          ],
          [
            "O-O",
            "Black castles too."
          ],
          [
            "Re1",
            "Rook to the center, behind your e-pawn. Every piece now has a job. This is a healthy position."
          ]
        ]
      },
      {
        "name": "Black plays ...Nf6 early",
        "moves": [
          [
            "e4",
            "Take the center."
          ],
          [
            "e5",
            "Black takes the center too."
          ],
          [
            "Nf3",
            "Develop and attack e5."
          ],
          [
            "Nc6",
            "Black defends e5."
          ],
          [
            "Bc4",
            "Bishop aims at f7."
          ],
          [
            "Nf6",
            "Black attacks your e4 pawn right away."
          ],
          [
            "d3",
            "Protect e4. You want a calm game where nothing of yours is left hanging."
          ],
          [
            "Be7",
            "Black develops quietly."
          ],
          [
            "O-O",
            "Castle early. Safe king first."
          ],
          [
            "O-O",
            "Black castles."
          ],
          [
            "Re1",
            "Rook to the center file."
          ],
          [
            "d6",
            "Black supports e5."
          ],
          [
            "c3",
            "Prepares d4 and gives your queen a route to b3 or c2. Your setup is complete."
          ]
        ]
      },
      {
        "name": "Black plays ...d6",
        "moves": [
          [
            "e4",
            "Take the center."
          ],
          [
            "e5",
            "Black takes the center too."
          ],
          [
            "Nf3",
            "Develop and attack e5."
          ],
          [
            "d6",
            "Black defends with a pawn instead of a knight. Solid but a bit passive."
          ],
          [
            "d4",
            "Grab even more center while Black is cramped."
          ],
          [
            "Nf6",
            "Black develops and hits e4."
          ],
          [
            "Nc3",
            "Develop and protect e4."
          ],
          [
            "Nbd7",
            "Black keeps e5 protected."
          ],
          [
            "Bc4",
            "Bishop to its best diagonal."
          ],
          [
            "Be7",
            "Black develops."
          ],
          [
            "O-O",
            "Castle."
          ],
          [
            "O-O",
            "Black castles. You have more space and easy development."
          ]
        ]
      },
      {
        "name": "Black plays ...a6",
        "moves": [
          [
            "e4",
            "Take the center."
          ],
          [
            "e5",
            "Black takes the center too."
          ],
          [
            "Nf3",
            "Develop and attack e5."
          ],
          [
            "Nc6",
            "Black defends e5."
          ],
          [
            "Bc4",
            "Bishop aims at f7."
          ],
          [
            "Bc5",
            "Black's bishop aims at f2."
          ],
          [
            "c3",
            "Prepare d4."
          ],
          [
            "Nf6",
            "Black attacks e4."
          ],
          [
            "d3",
            "Protect e4."
          ],
          [
            "a6",
            "Black makes a retreat square for the bishop on c5."
          ],
          [
            "O-O",
            "Castle."
          ],
          [
            "d6",
            "Black supports e5."
          ],
          [
            "a4",
            "Take space on the queenside and stop ...b5 from bothering your bishop."
          ]
        ]
      }
    ]
  },
  "vsE4": {
    "title": "Black vs 1.e4",
    "side": "b",
    "blurb": "Answer 1.e4 with 1...e5, then develop knights, bishops, and castle.",
    "lines": [
      {
        "name": "They play the Italian",
        "moves": [
          [
            "e4",
            "White takes the center."
          ],
          [
            "e5",
            "Take your share of the center."
          ],
          [
            "Nf3",
            "White attacks e5."
          ],
          [
            "Nc6",
            "Defend e5 by developing a knight."
          ],
          [
            "Bc4",
            "White's bishop aims at your f7."
          ],
          [
            "Bc5",
            "Put your bishop on the same kind of diagonal, aiming at f2."
          ],
          [
            "c3",
            "White prepares d4."
          ],
          [
            "Nf6",
            "Develop and attack e4."
          ],
          [
            "d3",
            "White protects e4."
          ],
          [
            "d6",
            "Protect e5 and open your light-squared bishop."
          ],
          [
            "O-O",
            "White castles."
          ],
          [
            "O-O",
            "Castle. Equal and comfortable."
          ]
        ]
      },
      {
        "name": "Early queen attack (Scholar's Mate)",
        "moves": [
          [
            "e4",
            "White takes the center."
          ],
          [
            "e5",
            "Take your share of the center."
          ],
          [
            "Qh5",
            "The queen comes out early. It attacks e5 and eyes f7."
          ],
          [
            "Nc6",
            "Defend e5 first. No panic."
          ],
          [
            "Bc4",
            "Now White threatens Qxf7#. Queen and bishop both hit f7."
          ],
          [
            "g6",
            "Block the queen's path to f7 and attack the queen at the same time."
          ],
          [
            "Qf3",
            "The queen aims at f7 again with the bishop. Another mate threat!"
          ],
          [
            "Nf6",
            "The knight blocks the queen from f7 and develops. Threat stopped."
          ],
          [
            "Ne2",
            "White develops."
          ],
          [
            "Bg7",
            "Bishop to the long diagonal, next to your g6 pawn. Castle next. That early queen will become a target."
          ]
        ]
      },
      {
        "name": "They play 2.Bc4",
        "moves": [
          [
            "e4",
            "White takes the center."
          ],
          [
            "e5",
            "Take your share."
          ],
          [
            "Bc4",
            "The bishop aims at f7."
          ],
          [
            "Nf6",
            "Develop and attack e4. It also keeps the queen off h5."
          ],
          [
            "d3",
            "White protects e4."
          ],
          [
            "Nc6",
            "Develop."
          ],
          [
            "Nf3",
            "White develops."
          ],
          [
            "Bc5",
            "Active bishop, aiming at f2."
          ],
          [
            "O-O",
            "White castles."
          ],
          [
            "d6",
            "Protect e5 and open your light-squared bishop. Castle next."
          ]
        ]
      },
      {
        "name": "They play the Spanish (3.Bb5)",
        "moves": [
          [
            "e4",
            "White takes the center."
          ],
          [
            "e5",
            "Take your share."
          ],
          [
            "Nf3",
            "White attacks e5."
          ],
          [
            "Nc6",
            "Defend e5."
          ],
          [
            "Bb5",
            "The bishop pressures your knight, which defends e5."
          ],
          [
            "a6",
            "Ask the bishop what it wants."
          ],
          [
            "Ba4",
            "It stays on the diagonal."
          ],
          [
            "Nf6",
            "Develop and hit e4."
          ],
          [
            "O-O",
            "White castles."
          ],
          [
            "Be7",
            "Develop and get ready to castle."
          ],
          [
            "Re1",
            "White protects e4."
          ],
          [
            "b5",
            "Now push the bishop away for real."
          ],
          [
            "Bb3",
            "It retreats."
          ],
          [
            "d6",
            "Support e5 and open your light-squared bishop."
          ],
          [
            "c3",
            "White prepares d4."
          ],
          [
            "O-O",
            "Castle. All your pieces are out and your king is safe."
          ]
        ]
      },
      {
        "name": "They play 3.d4 (Scotch)",
        "moves": [
          [
            "e4",
            "White takes the center."
          ],
          [
            "e5",
            "Take your share."
          ],
          [
            "Nf3",
            "White attacks e5."
          ],
          [
            "Nc6",
            "Defend e5."
          ],
          [
            "d4",
            "White attacks e5 again right away."
          ],
          [
            "exd4",
            "Take the pawn."
          ],
          [
            "Nxd4",
            "White recaptures in the center."
          ],
          [
            "Nf6",
            "Develop and attack e4."
          ],
          [
            "Nc3",
            "White defends e4."
          ],
          [
            "Bb4",
            "Pin the knight that defends e4."
          ],
          [
            "Nxc6",
            "White trades knights."
          ],
          [
            "bxc6",
            "Recapture toward the center."
          ],
          [
            "Bd3",
            "White protects e4."
          ],
          [
            "d5",
            "Strike at the center. Your pieces are active and you can castle next."
          ]
        ]
      }
    ]
  },
  "vsD4": {
    "title": "Black vs 1.d4",
    "side": "b",
    "blurb": "Answer 1.d4 with 1...d5, keep it solid with ...e6 and ...Nf6, then castle.",
    "lines": [
      {
        "name": "Queen's Gambit",
        "moves": [
          [
            "d4",
            "White takes the center."
          ],
          [
            "d5",
            "Match White in the center."
          ],
          [
            "c4",
            "The Queen's Gambit. White offers a pawn to pull your d-pawn away."
          ],
          [
            "e6",
            "Keep d5 solid. You don't need the pawn."
          ],
          [
            "Nc3",
            "More pressure on d5."
          ],
          [
            "Nf6",
            "Defend d5 again and develop."
          ],
          [
            "Bg5",
            "White pins your knight to your queen."
          ],
          [
            "Be7",
            "Break the pin and get ready to castle."
          ],
          [
            "e3",
            "White opens a path for the other bishop."
          ],
          [
            "O-O",
            "Castle early."
          ],
          [
            "Nf3",
            "White develops."
          ],
          [
            "Nbd7",
            "Develop and support the center. Solid and safe."
          ]
        ]
      },
      {
        "name": "London System",
        "moves": [
          [
            "d4",
            "White takes the center."
          ],
          [
            "d5",
            "Match White in the center."
          ],
          [
            "Nf3",
            "White develops."
          ],
          [
            "Nf6",
            "You develop too."
          ],
          [
            "Bf4",
            "The London System, a popular setup at every level."
          ],
          [
            "c5",
            "Challenge White's d4 pawn."
          ],
          [
            "e3",
            "White supports d4."
          ],
          [
            "Nc6",
            "Develop and add pressure to d4."
          ],
          [
            "c3",
            "White protects d4 with another pawn."
          ],
          [
            "e6",
            "Solid. It opens your dark-squared bishop."
          ],
          [
            "Nbd2",
            "White develops."
          ],
          [
            "Bd6",
            "Offer to trade off White's best bishop."
          ],
          [
            "Bg3",
            "White keeps the bishop."
          ],
          [
            "O-O",
            "Castle. Equal and comfortable."
          ]
        ]
      }
    ]
  }
} as Record<OpeningKey, OpeningSet>;

"""Select one exact, user-authored OUTPUT question, independent of player input."""
import json,random
from pathlib import Path
BANK=json.loads((Path(__file__).resolve().parent/'caption_questions.json').read_text())
PAIR_PREFERENCES={(3,5):[5,10],(4,9):[7,22],(1,2):[7,15],(11,12):[29,30]}

def select_caption(brief,question_id=None):
    if question_id is not None:
        if type(question_id) is not int or not 1<=question_id<=30:raise ValueError('caption_question_id must be 1..30')
        selected=BANK['questions'][question_id-1];method='explicit_selection'
    else:
        ids={x['id'] for x in brief['cards']};pair=tuple(sorted(ids));preferred=PAIR_PREFERENCES.get(pair,[])
        scored=[(10*len(ids.intersection(q['cards']))+(12 if q['id'] in preferred else 0),q) for q in BANK['questions']]
        best=max(score for score,_ in scored);pool=[q for score,q in scored if score==best]
        rng=random.Random(brief['numeric_layer']['derived_seed']^0xC4A710)
        selected=rng.choice(pool);method='card_affinity_then_seed'
    return {'id':selected['id'],'text':selected['text'],'bank_version':BANK['version'],'selection':method,
            'placement':'bottom margin within continuous four-sided warm-white mounting border','material':'soft graphite, gray-brown, handwritten pencil grain',
            'mounting_border':{'mat_mm':12.0,'page_mm':[210.0,297.0],'all_four_sides_equal':True,'top_matches_sides':True,'bottom_slightly_wider':False,'outer_edge_clear':True},
            'outer_frame':{'material':'light natural oak','equal_width':True,'mitered_corners':True,'view':'direct frontal','rail_mm':6.0},
            'render_text':False,'line_count':0,'lettering_size':None,'preserve_verbatim':True,'distinct_from_player_question':True}

def caption_instruction(caption):
    return ('Do not render the stored bottom caption question or signature. '
            'Only the meaningful micro labels within the organic artwork annotation layer may appear. '
            'Deliver the inner painting without a mat or frame. The final document compositor uses '
            'A4 210 x 297 mm, a 6 mm light-oak outer frame and a blank 12 mm mat on ALL FOUR sides.')

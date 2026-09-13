import unittest
from compose import compose,compose_from_seed_plate,prompt_for
from captions import BANK
class CaptionTests(unittest.TestCase):
 def test_bank_complete(self):
  self.assertEqual([q['id'] for q in BANK['questions']],list(range(1,31)))
  self.assertEqual(len({q['text'] for q in BANK['questions']}),30)
 def test_caption_does_not_rearrange_painting(self):
  x=compose([3,5],seed=9);y=compose([3,5],seed=9,caption_question_id=30)
  self.assertEqual(x['geometry'],y['geometry']);self.assertEqual(x['artwork_id'],y['artwork_id'])
  self.assertEqual(y['caption_question']['text'],BANK['questions'][29]['text'])
  self.assertNotEqual(x['presentation_id'],y['presentation_id'])
 def test_output_question_is_not_player_question(self):
  b=compose([3,5],seed=9)
  self.assertFalse(b['question']['provided']);self.assertTrue(b['caption_question']['text'])
  self.assertFalse(b['caption_question']['render_text'])
  self.assertNotIn(b['caption_question']['text'],prompt_for(b))
 def test_panel_adapter_exposes_override(self):
  b=compose_from_seed_plate({'m':3,'n':5,'a':.8,'b':.6,'seed':7},caption_question_id=22)
  self.assertEqual(b['caption_question']['id'],22)
 def test_invalid_override(self):
  for i in [0,31,True,'5']:
   with self.assertRaises(ValueError):compose([3,5],seed=9,caption_question_id=i)
 def test_stable_selection(self):
  self.assertEqual(compose([3,5],seed=9)['caption_question'],compose([3,5],seed=9)['caption_question'])
if __name__=='__main__':unittest.main(verbosity=2)

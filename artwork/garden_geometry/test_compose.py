"""No network, generation calls, printer code or parent-state writes."""
import itertools,json,math,unittest
from compose import compose,prompt_for,SOURCES
class CompositionTests(unittest.TestCase):
 def test_all_66_draws(self):
  seen=set()
  for cards in itertools.combinations(range(1,13),2):
   b=compose(list(cards),seed=12345)
   self.assertEqual({c['id'] for c in b['cards']},set(cards))
   self.assertEqual({g['semantic_card'] for g in b['geometry']},set(cards))
   self.assertTrue(all(math.isfinite(g['u']) and .10<=g['u']<=.90 and .10<=g['v']<=.90 for g in b['geometry']))
   self.assertEqual(len(b['geometry']),b['numeric_layer']['geometry_count'])
   self.assertIn(b['story']['title'],prompt_for(b));seen.add(b['artwork_id'])
  self.assertEqual(len(seen),66)
 def test_same_sum_different_card_meaning(self):
  x=compose([1,12],seed=9);y=compose([6,7],seed=9)
  self.assertEqual(x['numeric_layer']['sum'],y['numeric_layer']['sum'])
  self.assertNotEqual(x['story']['required_evidence'],y['story']['required_evidence'])
 def test_numbers_and_cards_remain_separate(self):
  x=compose([3,5],numbers=[4,9],seed=8)
  self.assertEqual([c['id'] for c in x['cards']],[3,5]);self.assertEqual(x['numeric_layer']['sum'],13)
  self.assertEqual(x['story']['title'],'是谁借谁抵达')
 def test_question_changes_semantics_and_randomness(self):
  # Synthetic test-only question; never used as a real player input or sent to imagegen.
  x=compose([3,5],seed=42);y=compose([3,5],seed=42,question='我应该留下还是离开？')
  self.assertFalse(x['question']['provided']);self.assertIn('choice',y['question']['themes'])
  self.assertNotEqual(x['numeric_layer']['derived_seed'],y['numeric_layer']['derived_seed'])
  self.assertNotEqual(x['geometry'],y['geometry']);self.assertTrue(y['story']['question_influence'])
 def test_repeatability(self):
  self.assertEqual(compose([3,5],seed=8),compose([3,5],seed=8))
 def test_no_invented_orientation(self):
  b=compose([11,12],seed=8)
  self.assertEqual(b['cards'][1]['orientation'],'unified')
  with self.assertRaises(ValueError):compose([11,12],seed=8,orientations=['both','reversed'])
 def test_invalid_inputs(self):
  for kw in [dict(card_ids=[1,1]),dict(card_ids=[1,13]),dict(card_ids=[1,2],a=1),dict(card_ids=[1,2],a=0,b=0),dict(card_ids=[1,2],seed=-1)]:
   with self.assertRaises(ValueError):compose(**kw)
 def test_returned_style_is_not_shared_mutable_state(self):
  b=compose([3,5],seed=8);b['style']['version']='changed'
  self.assertNotEqual(compose([3,5],seed=8)['style']['version'],'changed')
 def test_probability_extremes(self):
  for cards in [[1,2],[1,3],[10,12],[11,12]]:self.assertEqual(compose(cards,seed=2)['numeric_layer']['ways'],1)
if __name__=='__main__':unittest.main(verbosity=2)

"""Exact unordered-pair probabilities, plus artistic treatment for the two extreme sums."""
def rarity_for(m,n):
    total=m+n
    ways=sum(i+j==total for i in range(1,13) for j in range(i+1,13))
    kind='origin' if total==3 else 'palimpsest' if total==23 else 'rare' if ways<=3 else 'common'
    labels={'origin':'极值 · 初生','palimpsest':'极值 · 未命名','rare':'低频 · 偶然偏移','common':'常见 · 共生花园'}
    tokens={'origin':'E03','palimpsest':'E23','rare':'R','common':'C'}
    return {'sum':total,'ways':ways,'total_pairs':66,'probability':ways/66,'percent':round(ways/66*100,2),'kind':kind,'label':labels[kind],'token':tokens[kind]}

def rarity_prompt(m,n):
    r=rarity_for(m,n)
    descriptions={
      'origin':'EXTREME SUM 3 / ORIGIN: a radically sparse abstract garden. At least 70% luminous warm cream breathing space, only one or two off-center blush-pink and pale-lilac pigment remnants, isolated tender traces, a quiet singular emergence. No central seed icon. Preserve 20% oil-painted character within the marks and delicate aged abrasion.',
      'palimpsest':'EXTREME SUM 23 / PALIMPSEST: an unmistakably dense abstract garden after flourishing. At least 85% active overlapping pink/pale-lilac pigment territories; multiple intersecting layers, broken seams, accumulated traces and pronounced but elegant paint erosion. Fragmented openings show cream ground. Keep the same palette and 20% oil character, not darker blue or green.',
      'rare':'LOW-FREQUENCY SUM: create one clearly off-center rupture, an interrupted line or detached pigment island, with more asymmetric breathing space than the common composition. Keep the fixed palette and medium mix.',
      'common':'COMMON SUM RANGE: use the balanced, medium-density Garden baseline: several interacting pigment territories, roughly 25–40% breathing space, no extreme sparse or densely overgrown treatment.'}
    return f'Artistic rarity treatment ({r["ways"]}/66 exact probability for this sum): '+descriptions[r['kind']]

// Question themes follow the current twelve relationship cards in game-cards.js.
const themes={
  1:[3,4,9,15,30],2:[3,8,18,29,30],3:[7,10,19,22,29],
  4:[2,5,11,17,21,25],5:[5,7,10,20,22],6:[1,3,4,6,8,14,21,26,28],
  7:[7,10,11,18,19,22],8:[9,10,17,18,20,23],9:[1,6,12,13,19,24,26],
  10:[5,11,16,20,24,29],11:[2,12,16,24,27],12:[1,2,3,15,18,25,27,29,30]
};

export function selectQuestion(questions,{m,n,seed}){
  const scored=questions.map(question=>({question,score:[m,n].filter(card=>themes[card]?.includes(question.id)).length}));
  const best=Math.max(...scored.map(item=>item.score));
  const candidates=scored.filter(item=>item.score===best);
  // Stable for the archived work, including reloads, retries and reversed card order.
  let hash=(Number(seed)>>>0)^Math.imul(Math.min(m,n),374761393)^Math.imul(Math.max(m,n),668265263);
  hash=Math.imul(hash^(hash>>>13),1274126177);
  return candidates[((hash^(hash>>>16))>>>0)%candidates.length].question;
}

export function createQuestionReveal(host,questions){
  const visual=document.createElement('p'),announcement=document.createElement('p');
  visual.className='question-script';visual.setAttribute('aria-hidden','true');
  announcement.className='question-announcement';announcement.setAttribute('role','status');
  announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');
  host.append(visual,announcement);
  let question=null,key='',count=0,revealAt=null;
  function reset(){
    revealAt=null;host.hidden=true;host.dataset.state='coded';
    announcement.textContent='';host.closest('.theatre').classList.remove('question-active');
  }
  return {
    get question(){return question;},
    reset,
    bind(params){
      const nextKey=[Math.min(params.m,params.n),Math.max(params.m,params.n),params.seed].join(':');
      if(nextKey===key)return;
      key=nextKey;question=selectQuestion(questions,params);count=0;reset();
      host.dataset.questionId=question.id;
      visual.replaceChildren();
      // Keep AI, quotation marks and trailing punctuation together when wrapping.
      for(const token of question.text.match(/AI|“[^”]*”|——|.[，。；：！？、]?/gu)){
        const word=document.createElement('span');word.className='question-word';
        for(const char of token){
          const cell=document.createElement('span');cell.className='question-char';
          if(/[A-Za-z]/.test(char))cell.classList.add('question-latin');
          cell.style.setProperty('--reveal-delay',`${count*24}ms`);
          cell.style.setProperty('--pulse-delay',`${-count*.13}s`);
          const han=document.createElement('span');han.className='question-han';han.textContent=char;
          if(/[，。；：！？、——“”]/u.test(char)){
            cell.classList.add('question-punctuation');cell.append(han);
          }else{
            const glyph=document.createElement('img');glyph.className='question-glyph';glyph.alt='';
            const id=String(((char.codePointAt(0)^(Number(params.seed)>>>0))>>>0)%12+1).padStart(2,'0');
            glyph.src=new URL(`../motion/vectors/${id}.svg`,import.meta.url).href;
            cell.append(glyph,han);
          }
          word.append(cell);count++;
        }
        visual.append(word);
      }
    },
    update({active,complete,failed,reduced},now){
      if(!question||!active||failed){if(!host.hidden)reset();return;}
      if(host.hidden){host.hidden=false;host.closest('.theatre').classList.add('question-active');}
      host.dataset.reduced=String(reduced);
      if(!complete)return;
      if(revealAt===null){revealAt=now;host.dataset.state='decoding';}
      if(reduced||now-revealAt>=count*24+320){
        if(host.dataset.state==='revealed')return;
        host.dataset.state='revealed';announcement.textContent=question.text;
      }
    }
  };
}

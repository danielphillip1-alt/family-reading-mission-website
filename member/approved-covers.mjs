// Original covers taken from page 1 of each owner-approved edition, stored as
// approved-covers/<name>.jpg.b64. Covers are public artwork; books are not.
export const approvedCovers={
 'zachary-my-unique-hat-2026-11':{de:'zachary-book1-de',fr:'zachary-book1-fr',es:'zachary-book1-es',tr:'zachary-book1-tr'},
 'zachary-biggest-lesson-yet':{en:'zachary-book4-en',es:'zachary-book4-es',de:'zachary-book4-de','pt-PT':'zachary-book4-pt-PT'},
 'emir-meets-zachary':{en:'emir-book3-en',es:'emir-book3-es',de:'emir-book3-de',tr:'emir-book3-tr',fr:'emir-book3-fr'}
};
export const coverFile=(slug,lang)=>approvedCovers[slug]?.[lang]||null;

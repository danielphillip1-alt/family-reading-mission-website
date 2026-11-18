// Original covers taken from page 1 of each owner-approved edition, stored as
// approved-covers/<name>.jpg.b64. Covers are public artwork; books are not.
export const approvedCovers={
 'zachary-my-unique-hat-2026-11':{en:'zachary-book1-en','pt-PT':'zachary-book1-pt-PT',de:'zachary-book1-de',fr:'zachary-book1-fr',es:'zachary-book1-es',tr:'zachary-book1-tr'},
 'zachary-school-that-believed-in-him':{en:'zachary-book2-en',de:'zachary-book2-de','pt-PT':'zachary-book2-pt-PT',es:'zachary-book2-es',fr:'zachary-book2-fr',tr:'zachary-book2-tr'},
 'zachary-school-that-made-room':{en:'zachary-book3-en',de:'zachary-book3-de','pt-PT':'zachary-book3-pt-PT',es:'zachary-book3-es',fr:'zachary-book3-fr',tr:'zachary-book3-tr'},
 'zachary-biggest-lesson-yet':{en:'zachary-book4-en',es:'zachary-book4-es',de:'zachary-book4-de','pt-PT':'zachary-book4-pt-PT',fr:'zachary-book4-fr',tr:'zachary-book4-tr'},
 'zachary-foundation-of-something-great':{en:'zachary-book5-en',es:'zachary-book5-es',fr:'zachary-book5-fr',de:'zachary-book5-de','pt-PT':'zachary-book5-pt-PT',tr:'zachary-book5-tr'},
 'zachary-night-everyone-belonged':{en:'zachary-book6-en',es:'zachary-book6-es',fr:'zachary-book6-fr',de:'zachary-book6-de','pt-PT':'zachary-book6-pt-PT',tr:'zachary-book6-tr'},
 'emir-boy-who-never-smiles':{en:'emir-book1-en',de:'emir-book1-de',fr:'emir-book1-fr',es:'emir-book1-es',tr:'emir-book1-tr','pt-PT':'emir-book1-pt-PT'},
 'emir-barbershop-boys-and-salon-girls':{en:'emir-book2-en',de:'emir-book2-de',fr:'emir-book2-fr',es:'emir-book2-es',tr:'emir-book2-tr','pt-PT':'emir-book2-pt-PT'},
 'emir-meets-zachary':{en:'emir-book3-en',es:'emir-book3-es',de:'emir-book3-de',tr:'emir-book3-tr',fr:'emir-book3-fr','pt-PT':'emir-book3-pt-PT'}
};
export const coverFile=(slug,lang)=>approvedCovers[slug]?.[lang]||null;

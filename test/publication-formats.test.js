'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const server=fs.readFileSync('server.js','utf8');
const publisher=fs.readFileSync('js/publication-formats.js','utf8');
const reader=fs.readFileSync('js/book-reader.js','utf8');
const privacy=fs.readFileSync('js/publication-format-privacy.js','utf8');

test('book publications are bounded, private and retain a cover compatible with old posts',()=>{
 assert.match(server,/BOOK_PAGE_LIMIT=12/);
 assert.match(server,/uploadBookPages/);
 assert.match(server,/publicationType:art\.publicationType/);
 assert.match(server,/bookPageMatch/);
 assert.match(server,/canViewArt\(db,post,user\)/);
});

test('the publisher limits HQ/Mangá choices to manga projects and creates real GIF data',()=>{
 assert.match(publisher,/\['animation','manga'\]/);
 assert.match(publisher,/isManga\?'Publicar obra':'Publicar animação'/);
 assert.match(publisher,/GIF89a/);
 assert.match(publisher,/publicationType:type/);
});

test('the reader supports direction, swipe, controls and reduced motion',()=>{
 assert.match(reader,/post\.publicationType==='manga'/);
 assert.match(reader,/onpointerdown/);
 assert.match(reader,/prefers-reduced-motion/);
 assert.match(reader,/pages\//);
});

test('format publications retain description and privacy choices',()=>{
 assert.match(privacy,/aef-format-visibility/);
 assert.match(privacy,/body\.visibility/);
 assert.match(privacy,/body\.description/);
});

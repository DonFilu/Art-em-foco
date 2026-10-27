'use strict';
const crypto=require('crypto');
const readline=require('node:readline/promises');

(async()=>{
 const terminal=readline.createInterface({input:process.stdin,output:process.stderr,terminal:true});
 try{
  const password=await terminal.question('Senha administrativa (não será exibida): ',{hideEchoBack:true});
  if(password.length<12||password.length>200)throw Error('Use uma senha entre 12 e 200 caracteres.');
  const N=16384,r=8,p=1,salt=crypto.randomBytes(16),hash=await new Promise((resolve,reject)=>crypto.scrypt(password,salt,32,{N,r,p,maxmem:256*1024*1024},(error,value)=>error?reject(error):resolve(value)));
  process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}\n`);
 }finally{terminal.close()}
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1});

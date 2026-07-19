(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const playerArmSprite = new Image();
  playerArmSprite.src = 'assets/Tur-arm.png';

  const PORTRAIT = matchMedia('(orientation: portrait) and (max-width: 800px)').matches;
  const W = PORTRAIT?720:1280, H = PORTRAIT?Math.max(1200,Math.min(1600,Math.round(720*innerHeight/innerWidth))):720, GAME_DURATION = 300;
  const ROAD_L = PORTRAIT?80:360, ROAD_R = PORTRAIT?640:920, CROSS_HALF = 122.5, STOP_OFFSET = 167.5;
  const CROSS_AI_GAP = 22;
  const BLOCK_SPACING = PORTRAIT?H+550:1450, CAMERA_Y = PORTRAIT?Math.round(H*.56):390;
  const START_INTERSECTION_Y = PORTRAIT?H-460:367.5, PLAYER_X = Math.round(ROAD_L+(ROAD_R-ROAD_L)*.616), PLAYER_START_Y=H-110;
  canvas.width=W;canvas.height=H;
  const STREET_NAMES = window.VINOHRADY_STREETS || ['Vinohradská','Korunní','Slezská'];
  const keys = { up:false, down:false, left:false, right:false };
  const touchInput = { active:false, x:0, y:0, pointerId:null };
  const ui = Object.fromEntries(['score','best','time','startScreen','gameOverScreen','pauseScreen','finishScreen','finalScore','finishScore','crashTitle','crashText','lightLabel','miniLight','phaseBar','toast','violationList','violationCount'].map(id => [id, document.getElementById(id)]));

  let state = 'menu', last = 0, elapsed = 0, score = 0, best = +(localStorage.getItem('krizovatka63-best') || 0);
  let lightClock = 0, lightState = 'red', lastLightState = '', traffic = [], roadTraffic = [], particles = [], spawnClock = 0, roadSpawnClock = 0, crossed = false, shake = 0, toastTimer = 0;
  let intersectionY = START_INTERSECTION_Y, worldScroll = 0, intersectionIndex = 0, streetDeck = [], violations = [];
  const player = { x:PLAYER_X, y:PLAYER_START_Y, w:48, h:86, speed:0, steerSpeed:0 };

  const colors = { asphalt:'#293135', asphalt2:'#252c30', pavement:'#7b7d76', curb:'#c3b864', grass:'#446c37', white:'#dbddd2' };
  const rand = (a,b) => a + Math.random() * (b-a);
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const pad = n => n<0?'-'+String(Math.abs(Math.floor(n))).padStart(5,'0'):String(Math.floor(n)).padStart(6,'0');
  const rectsHit = (a,b,pad=5) => a.x+pad < b.x+b.w-pad && a.x+a.w-pad > b.x+pad && a.y+pad < b.y+b.h-pad && a.y+a.h-pad > b.y+pad;
  function shuffle(list){for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]]}return list}

  function reset(){
    elapsed=0; score=0; lightClock=0; lightState='red'; lastLightState=''; traffic=[]; roadTraffic=[]; particles=[]; spawnClock=.2;roadSpawnClock=.35;crossed=false;shake=0;
    intersectionY=START_INTERSECTION_Y;worldScroll=0;intersectionIndex=0;streetDeck=shuffle([...STREET_NAMES]);violations=[];
    Object.assign(player,{x:PLAYER_X,y:PLAYER_START_Y,speed:0,steerSpeed:0});
    seedIntersectionEmergency(true);
    renderViolations();
    updateHud();
  }
  function start(){ reset(); state='playing'; hideScreens(); last=performance.now(); }
  function hideScreens(){ document.querySelectorAll('.screen').forEach(e=>e.classList.remove('active')); }
  function setPause(on){
    if(on && state==='playing'){ state='paused'; ui.pauseScreen.classList.add('active'); }
    else if(!on && state==='paused'){ state='playing'; ui.pauseScreen.classList.remove('active'); last=performance.now(); }
  }
  function gameOver(type){
    if(state!=='playing') return;
    state='over'; shake=18;
    const info = type==='red' ? ['ČERVENÁ!','Projíždět na červenou se nevyplácí.'] : ['NEHODA!','Nedobrzdil jsi před jiným vozidlem.'];
    ui.crashTitle.textContent=info[0]; ui.crashText.textContent=info[1]; ui.finalScore.textContent=pad(score);
    best=Math.max(best,Math.floor(score)); localStorage.setItem('krizovatka63-best',best); updateHud();
    for(let i=0;i<26;i++) particles.push({x:player.x+player.w/2,y:player.y+player.h/2,vx:rand(-150,150),vy:rand(-150,150),life:rand(.4,1),c:i%3?'#ffb52c':'#e84c2e'});
    setTimeout(()=>ui.gameOverScreen.classList.add('active'),500);
  }
  function finishGame(){
    if(state!=='playing')return;
    state='finished';best=Math.max(best,Math.floor(score));localStorage.setItem('krizovatka63-best',best);
    ui.finishScore.textContent=pad(score);updateHud();ui.finishScreen.classList.add('active');
  }
  function formatClock(seconds){const s=Math.max(0,Math.floor(seconds));return String(s/60|0).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
  function recordViolation(label,points){
    score+=points;violations.unshift({label,points,time:formatClock(elapsed)});renderViolations();
  }
  function renderViolations(){
    ui.violationCount.textContent=violations.length;ui.violationList.replaceChildren();
    if(!violations.length){const li=document.createElement('li');li.className='empty';li.textContent='ČISTÁ JÍZDA';ui.violationList.append(li);return}
    for(const item of violations.slice(0,7)){
      const li=document.createElement('li'),time=document.createElement('time'),label=document.createElement('span'),points=document.createElement('strong');
      time.textContent=item.time;label.textContent=item.label;points.textContent=String(item.points).replace('-', '–');li.append(time,label,points);ui.violationList.append(li);
    }
  }
  function updateLight(){
    const cycle = lightClock % 15;
    lightState = cycle < 6.7 ? 'red' : cycle < 7.7 ? 'yellow' : cycle < 13.8 ? 'green' : 'yellow';
    if(lightState!==lastLightState){
      lastLightState=lightState;
      ui.miniLight.className='mini-light '+lightState;
      const data={red:['STŮJ','#ff4b39'],yellow:['POZOR','#ffc52e'],green:['VOLNO','#73dc4d']}[lightState];
      ui.lightLabel.textContent=data[0]; ui.lightLabel.style.color=data[1]; document.querySelector('.traffic-card').style.borderColor=data[1]; ui.phaseBar.style.background=data[1];
    }
    const ranges={red:[0,6.7],yellow:lightClock%15<7.7?[6.7,7.7]:[13.8,15],green:[7.7,13.8]};
    const r=ranges[lightState], progress=((cycle-r[0])/(r[1]-r[0]))*100; ui.phaseBar.style.width=(100-clamp(progress,0,100))+'%';
  }
  function spawnVehicle(){
    const emergency=Math.random()<Math.min(.16+elapsed/300,.28), fromLeft=Math.random()<.5;
    const kind=emergency?(Math.random()<.52?'ambulance':'police'):(Math.random()<.16?'van':'car');
    const sizes={ambulance:[88,45],police:[69,38],van:[76,42],car:[64,36]};
    const [w,h]=sizes[kind], lane=intersectionY+(fromLeft?-52.5:37.5);
    const palettes=['#d54730','#e5aa2d','#5e9ac9','#76a34d','#a65faf','#d8d0b7'];
    traffic.push({x:fromLeft?-w-10:W+10,y:lane,w,h,vx:(fromLeft?1:-1)*rand(185,270)*(emergency?1.25:1),kind,emergency,color:palettes[Math.floor(Math.random()*palettes.length)],passed:false});
  }
  function seedIntersectionEmergency(initial=false){
    // A pre-timed emergency vehicle is already crossing when the player reaches the junction.
    if(Math.random()>.64)return;
    const count=Math.random()<.22?2:1;
    for(let i=0;i<count;i++){
      const fromLeft=i%2===0?Math.random()<.5:true,kind=Math.random()<.52?'ambulance':'police';
      const sizes={ambulance:[88,45],police:[69,38]},[w,h]=sizes[kind];
      const speed=rand(285,355),vx=(fromLeft?1:-1)*speed;
      const estimatedArrival=initial?0:clamp((CAMERA_Y-(intersectionY+STOP_OFFSET))/Math.max(350,-player.speed),.7,2.6);
      const targetX=rand(ROAD_L+90,ROAD_R-90)+(i?rand(-80,80):0);
      traffic.push({x:targetX-vx*estimatedArrival,y:intersectionY+(fromLeft?-52.5:37.5),w,h,vx,kind,emergency:true,color:'#ecebe3',passed:false});
    }
  }
  function spawnRoadVehicle(cameraSpeed){
    const northbound=Math.random()<.56,lane=northbound?(Math.random()<.5?2:3):(Math.random()<.5?0:1);
    const emergency=Math.random()<.1,kind=emergency?(Math.random()<.5?'ambulance':'police'):'car';
    const w=kind==='ambulance'?46:42,h=kind==='ambulance'?82:rand(66,76),speed=rand(185,290)*(emergency?1.18:1);
    const laneWidth=(ROAD_R-ROAD_L)/4,x=ROAD_L+lane*laneWidth+(laneWidth-w)/2+rand(-12,12);
    const vy=northbound?-speed:speed,relative=vy+cameraSpeed;
    const y=relative>0?-h-rand(15,100):H+rand(15,100);
    const palettes=['#cf4b35','#e0a62c','#4f8db8','#6d9b46','#9855a0','#d4c9ad','#efefea'];
    roadTraffic.push({x,y,w,h,vy,lane,kind,emergency,color:palettes[Math.floor(Math.random()*palettes.length)]});
  }
  function update(dt){
    elapsed=Math.min(GAME_DURATION,elapsed+dt);lightClock+=dt;score+=dt*12;updateLight();
    if(elapsed>=GAME_DURATION){updateHud();finishGame();return}
    const previousFront=player.y, previousStop=intersectionY+STOP_OFFSET, previousNorth=intersectionY-CROSS_HALF;
    const previousPlayerCenterX=player.x+player.w/2;
    const accel=820, friction=620, max=505;
    const driveAxis=touchInput.active?touchInput.y:(keys.down?1:0)-(keys.up?1:0);
    if(Math.abs(driveAxis)>.08) player.speed+=accel*driveAxis*dt;
    else player.speed += (player.speed<0?1:-1)*Math.min(Math.abs(player.speed),friction*dt);
    player.speed=clamp(player.speed,-max,max*.58); player.y+=player.speed*dt; player.y=clamp(player.y,76,H-player.h-12);
    let scrollDelta=0;
    if(player.speed<0&&player.y<CAMERA_Y){scrollDelta=CAMERA_Y-player.y;player.y=CAMERA_Y;intersectionY+=scrollDelta;worldScroll+=scrollDelta;for(const v of traffic)v.y+=scrollDelta;for(const v of roadTraffic)v.y+=scrollDelta}
    const cameraSpeed=scrollDelta/dt;
    const steerAccel=620, steerMax=245;
    const steerAxis=touchInput.active?touchInput.x:(keys.right?1:0)-(keys.left?1:0);
    if(touchInput.active)player.steerSpeed=steerAxis*steerMax;
    else if(Math.abs(steerAxis)>.08)player.steerSpeed+=steerAccel*steerAxis*dt;
    else player.steerSpeed+=(player.steerSpeed<0?1:-1)*Math.min(Math.abs(player.steerSpeed),780*dt);
    player.steerSpeed=clamp(player.steerSpeed,-steerMax,steerMax);
    player.x+=player.steerSpeed*dt;
    const roadPadding=18;
    const boundedX=clamp(player.x,ROAD_L+roadPadding,ROAD_R-roadPadding-player.w);
    if(boundedX!==player.x) player.steerSpeed=0;
    player.x=boundedX;

    const playerCenterX=player.x+player.w/2,centerLine=(ROAD_L+ROAD_R)/2;
    const outsideIntersection=player.y+player.h/2<intersectionY-CROSS_HALF||player.y+player.h/2>intersectionY+CROSS_HALF;
    if(outsideIntersection&&(previousPlayerCenterX<centerLine)!==(playerCenterX<centerLine)){
      recordViolation('PŘES PLNOU ČÁRU',-250);showToast('–250  PŘES PLNOU ČÁRU');
    }

    // Crossing the southern stop line while the vertical direction is red is an immediate violation.
    const currentStop=intersectionY+STOP_OFFSET, currentNorth=intersectionY-CROSS_HALF;
    // Penalties deliberately remain unclamped: the score can continue below zero.
    if(lightState==='red' && previousFront>=previousStop && player.y<currentStop){recordViolation('PRŮJEZD NA ČERVENOU',-1000);showToast('–1000  PRŮJEZD NA ČERVENOU');shake=Math.max(shake,4)}
    if(!crossed && previousFront+player.h>=previousNorth && player.y+player.h<currentNorth){ crossed=true; score+=500; showToast('+500  ČISTÝ PRŮJEZD'); }
    if(intersectionY>H+285){
      intersectionY-=BLOCK_SPACING;intersectionIndex++;crossed=false;traffic=[];spawnClock=.15;
      seedIntersectionEmergency(false);
      lightClock=Math.random()<.48?rand(.4,3.6):rand(7.8,10.6);lastLightState='';updateLight();
      showToast('PŘED TEBOU: '+district().street);
    }

    spawnClock-=dt;
    if(spawnClock<=0&&intersectionY>80&&intersectionY<650){ spawnVehicle(); spawnClock=rand(.42,.86)*Math.max(.62,1-elapsed/260); }
    roadSpawnClock-=dt;
    if(roadSpawnClock<=0){spawnRoadVehicle(cameraSpeed);roadSpawnClock=rand(.48,1.0)*Math.max(.68,1-elapsed/300)}
    repairCrossTrafficConflicts();
    const horizontalGreen=lightState==='red';
    advanceTrafficLane(traffic.filter(v=>v.vx>0),1,dt,horizontalGreen);
    advanceTrafficLane(traffic.filter(v=>v.vx<0),-1,dt,horizontalGreen);
    for(const v of traffic){
      if(v.emergency && Math.random()<dt*12) particles.push({x:v.x+v.w/2,y:v.y,vx:rand(-12,12),vy:rand(-16,2),life:.2,c:Math.random()<.5?'#28a8ff':'#ff3d35'});
      if(rectsHit(player,v,7)) gameOver('crash');
    }
    for(let lane=0;lane<4;lane++){
      advanceRoadLane(roadTraffic.filter(v=>v.lane===lane&&v.vy<0),-1,dt,lightState==='green');
      advanceRoadLane(roadTraffic.filter(v=>v.lane===lane&&v.vy>0),1,dt,lightState==='green');
    }
    for(const v of roadTraffic){
      if(v.emergency&&Math.random()<dt*10)particles.push({x:v.x+v.w/2,y:v.y+v.h/2,vx:rand(-12,12),vy:rand(-12,12),life:.2,c:Math.random()<.5?'#28a8ff':'#ff3d35'});
      if(rectsHit(player,v,7))gameOver('crash');
    }
    repairCrossTrafficConflicts();
    traffic=traffic.filter(v=>v.x>-900&&v.x<W+900&&v.y>-800&&v.y<H+800);
    roadTraffic=roadTraffic.filter(v=>v.y>-220&&v.y<H+220);
    updateParticles(dt); updateHud();
    if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)ui.toast.classList.remove('show')}
  }
  function advanceTrafficLane(vehicles,direction,dt,horizontalGreen){
    // Process the leading car first so every follower can react to its new position.
    vehicles.sort((a,b)=>direction>0?b.x-a.x:a.x-b.x);
    const stopX=direction>0?ROAD_L-34:ROAD_R+34;
    const safeGap=22;
    let leader=null;
    for(const v of vehicles){
      let move=Math.abs(v.vx)*dt;
      const nose=direction>0?v.x+v.w:v.x;
      const mayGo=horizontalGreen||v.emergency;

      // Normal traffic brakes exactly at the line instead of stepping through it.
      if(!mayGo){
        if(direction>0&&nose<=stopX) move=Math.min(move,Math.max(0,stopX-nose));
        if(direction<0&&nose>=stopX) move=Math.min(move,Math.max(0,nose-stopX));
      }

      if(leader){
        const gap=direction>0?leader.x-(v.x+v.w):v.x-(leader.x+leader.w);
        if(gap<safeGap){
          // Repair any overlap left from an older frame or a freshly formed queue.
          v.x=direction>0?leader.x-v.w-safeGap:leader.x+leader.w+safeGap;
          move=0;
        }else move=Math.min(move,gap-safeGap);
      }

      move=limitAiMove(v,direction,move,true);
      v.x+=direction*move;
      leader=v;
    }
  }
  function advanceRoadLane(vehicles,direction,dt,verticalGreen){
    vehicles.sort((a,b)=>direction>0?b.y-a.y:a.y-b.y);
    const stopY=direction<0?intersectionY+STOP_OFFSET:intersectionY-STOP_OFFSET;
    const safeGap=26;
    let leader=null;
    for(const v of vehicles){
      let move=Math.abs(v.vy)*dt;
      const nose=direction<0?v.y:v.y+v.h;
      if(!verticalGreen&&!v.emergency){
        if(direction<0&&nose>=stopY)move=Math.min(move,Math.max(0,nose-stopY));
        if(direction>0&&nose<=stopY)move=Math.min(move,Math.max(0,stopY-nose));
      }
      if(leader){
        const gap=direction<0?v.y-(leader.y+leader.h):leader.y-(v.y+v.h);
        if(gap<safeGap){v.y=direction<0?leader.y+leader.h+safeGap:leader.y-v.h-safeGap;move=0}
        else move=Math.min(move,gap-safeGap);
      }
      const playerLane=clamp(Math.floor((player.x+player.w/2-ROAD_L)/((ROAD_R-ROAD_L)/4)),0,3);
      if(v.lane===playerLane){
        if(direction<0&&v.y>=player.y+player.h){const gap=v.y-(player.y+player.h);move=Math.min(move,Math.max(0,gap-safeGap))}
        if(direction>0&&v.y+v.h<=player.y){const gap=player.y-(v.y+v.h);move=Math.min(move,Math.max(0,gap-safeGap))}
      }
      move=limitAiMove(v,direction,move,false);
      v.y+=direction*move;leader=v;
    }
  }
  function limitAiMove(vehicle,direction,move,horizontal){
    if(move<=0)return 0;
    const others=horizontal?roadTraffic:traffic;
    if(!others.length)return move;
    const steps=Math.max(1,Math.ceil(move/3));
    let allowed=0;
    for(let i=1;i<=steps;i++){
      const distance=move*i/steps;
      const x=horizontal?vehicle.x+direction*distance:vehicle.x;
      const y=horizontal?vehicle.y:vehicle.y+direction*distance;
      const blocked=others.some(other=>x+vehicle.w+CROSS_AI_GAP>other.x&&x-CROSS_AI_GAP<other.x+other.w&&y+vehicle.h+CROSS_AI_GAP>other.y&&y-CROSS_AI_GAP<other.y+other.h);
      if(blocked)break;
      allowed=distance;
    }
    return allowed;
  }
  function repairCrossTrafficConflicts(){
    // Spawned and pre-seeded vehicles can begin a frame already touching. Merely
    // stopping them would preserve the overlap forever, so move one behind the other.
    for(let pass=0;pass<3;pass++){
      let repaired=false;
      for(const horizontal of traffic){
        for(const vertical of roadTraffic){
          const conflict=horizontal.x+horizontal.w+CROSS_AI_GAP>vertical.x&&horizontal.x-CROSS_AI_GAP<vertical.x+vertical.w&&horizontal.y+horizontal.h+CROSS_AI_GAP>vertical.y&&horizontal.y-CROSS_AI_GAP<vertical.y+vertical.h;
          if(!conflict)continue;
          const horizontalTarget=horizontal.vx>0?vertical.x-horizontal.w-CROSS_AI_GAP:vertical.x+vertical.w+CROSS_AI_GAP;
          const verticalTarget=vertical.vy<0?horizontal.y+horizontal.h+CROSS_AI_GAP:horizontal.y-vertical.h-CROSS_AI_GAP;
          const horizontalShift=Math.abs(horizontalTarget-horizontal.x),verticalShift=Math.abs(verticalTarget-vertical.y);
          const moveHorizontal=vertical.emergency&&!horizontal.emergency?true:horizontal.emergency&&!vertical.emergency?false:horizontalShift<=verticalShift;
          if(moveHorizontal)horizontal.x=horizontalTarget;
          else vertical.y=verticalTarget;
          repaired=true;
        }
      }
      if(!repaired)break;
    }
  }
  function updateParticles(dt){ for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;p.vy+=80*dt} particles=particles.filter(p=>p.life>0); }
  function updateHud(){ui.score.textContent=pad(score);ui.best.textContent=pad(best);ui.time.textContent=formatClock(GAME_DURATION-elapsed)}
  function showToast(t){ui.toast.textContent=t;ui.toast.classList.add('show');toastTimer=1.5}

  function pxRect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h))}
  function district(){
    const districts=[
      {street:'VINOHRADSKÁ',wall:'#9a4b37',wall2:'#a27d52',accent:'#d8bd65'},
      {street:'ŽIŽKOVSKÁ',wall:'#76574b',wall2:'#8d3f38',accent:'#70a8b5'},
      {street:'KARLÍNSKÁ',wall:'#9b744b',wall2:'#576f76',accent:'#df8e52'},
      {street:'LETENSKÁ',wall:'#754d6c',wall2:'#9b603e',accent:'#85a957'},
      {street:'NÁDRAŽNÍ',wall:'#596a70',wall2:'#82463c',accent:'#cfbd83'}
    ];
    if(!streetDeck.length)streetDeck=[...STREET_NAMES];
    return {...districts[intersectionIndex%districts.length],street:streetDeck[intersectionIndex%streetDeck.length]};
  }
  function drawWorld(){
    const crossT=intersectionY-CROSS_HALF,crossB=intersectionY+CROSS_HALF,d=district();
    // grass and city blocks
    ctx.fillStyle=colors.grass;ctx.fillRect(0,0,W,H);
    pxRect(0,0,ROAD_L,H,colors.pavement);pxRect(ROAD_R,0,W-ROAD_R,H,colors.pavement);
    pxRect(ROAD_L,0,ROAD_R-ROAD_L,H,colors.asphalt);pxRect(0,crossT,W,crossB-crossT,colors.asphalt);
    // asphalt patches
    ctx.fillStyle='#252d30';for(let i=0;i<55;i++){const x=(i*137)%W,y=(i*83)%H;ctx.fillRect(x,y,2+(i%4),2)}
    // curbs
    pxRect(ROAD_L-9,0,9,crossT,colors.curb);pxRect(ROAD_R,0,9,crossT,colors.curb);pxRect(ROAD_L-9,crossB,9,H-crossB,colors.curb);pxRect(ROAD_R,crossB,9,H-crossB,colors.curb);
    pxRect(0,crossT-9,ROAD_L,9,colors.curb);pxRect(ROAD_R,crossT-9,W-ROAD_R,9,colors.curb);pxRect(0,crossB,ROAD_L,9,colors.curb);pxRect(ROAD_R,crossB,W-ROAD_R,9,colors.curb);
    // Four vertical lanes: two northbound, two southbound.
    ctx.fillStyle='#d8d9cd';for(let y=(worldScroll%55)-55;y<H;y+=55){if(y>crossT-15&&y<crossB+15)continue;ctx.fillRect(ROAD_L+137,y,5,28);ctx.fillRect(ROAD_L+417,y,5,28)}
    ctx.fillStyle='#d2aa32';
    const roadCenter=(ROAD_L+ROAD_R)/2;
    if(crossT>0){ctx.fillRect(roadCenter-4,0,3,crossT);ctx.fillRect(roadCenter+4,0,3,crossT)}
    if(crossB<H){ctx.fillRect(roadCenter-4,Math.max(0,crossB),3,H-Math.max(0,crossB));ctx.fillRect(roadCenter+4,Math.max(0,crossB),3,H-Math.max(0,crossB))}
    // horizontal lanes
    for(let x=0;x<W;x+=62){if(x>ROAD_L-20&&x<ROAD_R+20)continue;ctx.fillRect(x,intersectionY-2,31,5)}
    // crosswalks
    ctx.fillStyle='#d8d9cd';for(let x=ROAD_L+15;x<ROAD_R-10;x+=31){ctx.fillRect(x,crossT+8,18,7);ctx.fillRect(x,crossB-15,18,7)}
    for(let y=crossT+12;y<crossB-12;y+=29){ctx.fillRect(ROAD_L+8,y,7,17);ctx.fillRect(ROAD_R-15,y,7,17)}
    // stop lines
    pxRect(ROAD_L+18,intersectionY+STOP_OFFSET,ROAD_R-ROAD_L-36,8,'#e8e7da');pxRect(ROAD_L+18,intersectionY-STOP_OFFSET,ROAD_R-ROAD_L-36,8,'#e8e7da');
    // sidewalks grid + buildings
    ctx.strokeStyle='#636862';ctx.lineWidth=1;for(let x=0;x<W;x+=38){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,crossT-9);ctx.moveTo(x,crossB+9);ctx.lineTo(x,H);ctx.stroke()}for(let y=(worldScroll%38)-38;y<H;y+=38){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(ROAD_L-9,y);ctx.moveTo(ROAD_R+9,y);ctx.lineTo(W,y);ctx.stroke()}
    drawBuildings(crossT,crossB,d); drawLights(crossT,crossB);
  }
  function drawBuildings(crossT,crossB,d){
    const labels=[['KAVÁRNA','HOTEL 63','SERVIS','PNEU'],['VINYL','KINO','BISTRO','DÍLNA'],['PEKÁRNA','ATELIÉR','MARKET','GARÁŽ']][intersectionIndex%3];
    const leftX=10,leftW=Math.max(56,ROAD_L-28),rightX=ROAD_R+18,rightW=Math.max(56,W-rightX-10);
    building(leftX,crossT-140,leftW,112,d.wall,'#2a3134',labels[0]);building(rightX,crossT-203,rightW,150,d.wall2,'#26343a',labels[1]);building(leftX,crossB+60,leftW,150,d.wall2,'#233238',labels[2]);building(rightX,crossB+58,rightW,150,d.wall,'#28343a',labels[3]);
    // small trees
    [[ROAD_L-40,crossT-173],[ROAD_L-40,crossB+150],[ROAD_R+38,crossT-150],[ROAD_R+38,crossB+140]].forEach(([x,y])=>{pxRect(x-5,y+12,10,20,'#5b3924');pxRect(x-22,y-10,44,35,'#255d31');pxRect(x-14,y-19,28,38,'#367b38');pxRect(x-7,y-24,15,17,'#4b963f')});
    const signX=ROAD_R+12,signW=Math.max(64,Math.min(230,W-signX-10)),fontSize=clamp(Math.floor((signW-18)/Math.max(8,d.street.length*.58)),6,12);
    pxRect(signX,crossT-35,signW,23,'#174f70');ctx.fillStyle='#e8f2e8';ctx.font=`bold ${fontSize}px monospace`;ctx.textAlign='center';ctx.fillText(d.street,signX+signW/2,crossT-19);
  }
  function building(x,y,w,h,wall,roof,label){pxRect(x,y,w,h,roof);pxRect(x+5,y+8,w-10,h-16,wall);pxRect(x+8,y+22,w-16,30,'#171c1e');ctx.fillStyle='#e7c86b';ctx.font=`bold ${clamp(Math.floor((w-12)/Math.max(3,label.length*.62)),7,15)}px monospace`;ctx.textAlign='center';ctx.fillText(label,x+w/2,y+43);for(let wx=x+12;wx<x+w-12;wx+=38){pxRect(wx,y+67,22,28,'#14252d');pxRect(wx+3,y+71,6,20,'#6993a2');pxRect(wx+12,y+71,6,20,'#507687')}}
  function drawLights(crossT,crossB){
    const green=lightState==='green',yellow=lightState==='yellow',red=lightState==='red';
    trafficLight(ROAD_R-25,crossB+16,red,yellow,green);trafficLight(ROAD_L-25,crossT-30,red,yellow,green);
    const horizontalRed=green,horizontalGreen=red;
    trafficLight(ROAD_L-25,crossB-28,horizontalRed,yellow,horizontalGreen,true);trafficLight(ROAD_R-25,crossT+28,horizontalRed,yellow,horizontalGreen,true);
  }
  function trafficLight(x,y,r,yw,g,horizontal=false){pxRect(x,y,9,52,'#1a1e1f');pxRect(x-8,y-7,25,38,'#090b0c');const cols=[r?'#ff4035':'#391a18',yw?'#ffd02c':'#3a331b',g?'#59df4b':'#18361c'];cols.forEach((c,i)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(x+4.5,y+i*11,4,0,7);ctx.fill()});if(horizontal){/* paired road signal */}}
  function drawVehicle(v){
    ctx.save();if(v.vx<0){ctx.translate(v.x+v.w,v.y);ctx.scale(-1,1)}else ctx.translate(v.x,v.y);
    if(v.kind==='ambulance') drawAmbulance(v.w,v.h);else if(v.kind==='police') drawPolice(v.w,v.h);else drawCarSide(v.w,v.h,v.color,v.kind==='van');ctx.restore();
  }
  function drawCarSide(w,h,c,van){pxRect(2,8,w-4,h-12,'#101416');pxRect(7,3,w-18,h-7,c);pxRect(van?14:19,6,van?w-30:w-37,h-15,'#8fb2bb');pxRect(van?17:22,8,van?w-36:12,h-19,'#23333a');if(!van)pxRect(38,8,w-48,h-19,'#23333a');pxRect(7,h-8,13,8,'#111');pxRect(w-22,h-8,13,8,'#111');pxRect(w-5,12,5,9,'#ffe890')}
  function drawAmbulance(w,h){drawCarSide(w,h,'#eee9dc',true);pxRect(38,11,21,5,'#d43c35');pxRect(46,3,5,21,'#d43c35');pxRect(18,0,9,5,(Math.floor(elapsed*8)%2)?'#ff3028':'#56b6ff');pxRect(65,0,9,5,(Math.floor(elapsed*8)%2)?'#56b6ff':'#ff3028')}
  function drawPolice(w,h){drawCarSide(w,h,'#e9ece6',false);pxRect(18,20,w-30,8,'#225f93');pxRect(27,0,8,5,(Math.floor(elapsed*10)%2)?'#ff3b35':'#219bff');pxRect(36,0,8,5,(Math.floor(elapsed*10)%2)?'#219bff':'#ff3b35')}
  function drawRoadVehicle(v){
    ctx.save();ctx.translate(v.x+v.w/2,v.y+v.h/2);if(v.vy>0)ctx.rotate(Math.PI);
    const x=-v.w/2,y=-v.h/2,w=v.w,h=v.h,body=v.kind==='ambulance'?'#ecebe3':v.kind==='police'?'#e9ece6':v.color;
    pxRect(x+4,y,w-8,h,'#0b0e10');pxRect(x,y+10,w,h-20,body);pxRect(x+4,y+4,w-8,h-8,body);
    pxRect(x+7,y+15,w-14,17,'#17262d');pxRect(x+9,y+18,w-18,11,'#72909a');pxRect(x+7,y+h-27,w-14,12,'#26343a');
    pxRect(x-3,y+14,5,17,'#080a0b');pxRect(x+w-2,y+14,5,17,'#080a0b');pxRect(x-3,y+h-30,5,17,'#080a0b');pxRect(x+w-2,y+h-30,5,17,'#080a0b');
    pxRect(x+7,y+2,8,5,'#f4e7b6');pxRect(x+w-15,y+2,8,5,'#f4e7b6');pxRect(x+7,y+h-7,8,5,'#b82e29');pxRect(x+w-15,y+h-7,8,5,'#b82e29');
    if(v.kind==='ambulance'){pxRect(x+5,y+37,w-10,9,'#d34139');pxRect(x+w/2-4,y+31,8,21,'#d34139')}
    if(v.kind==='police')pxRect(x+4,y+37,w-8,9,'#2c6594');
    if(v.emergency){const blink=Math.floor(elapsed*10)%2;pxRect(x+8,y+8,10,5,blink?'#ff3530':'#278fff');pxRect(x+w-18,y+8,10,5,blink?'#278fff':'#ff3530')}
    ctx.restore();
  }
  function drawPlayer(){
    const x=player.x,y=player.y,w=player.w,h=player.h;
    // shadow
    pxRect(x+5,y+7,w,h,'#1118');
    // Draw behind the body so the sleeve is visibly occluded by the right window frame.
    drawPlayerArm(x+w-7,y+16);
    pxRect(x,y+5,w,h-10,'#080a0c');pxRect(x+4,y,w-8,h,'#15191c');
    pxRect(x+7,y+14,w-14,22,'#30383d');pxRect(x+10,y+18,w-20,14,'#10191e');pxRect(x+8,y+49,w-16,19,'#262d31');
    pxRect(x+2,y+15,5,18,'#050607');pxRect(x+w-7,y+15,5,18,'#050607');pxRect(x+2,y+57,5,18,'#050607');pxRect(x+w-7,y+57,5,18,'#050607');
    pxRect(x+8,y+2,9,6,'#e9e2bf');pxRect(x+w-17,y+2,9,6,'#e9e2bf');pxRect(x+9,y+h-7,8,5,'#bd3129');pxRect(x+w-17,y+h-7,8,5,'#bd3129');
    // spare wheel + Mercedes star
    ctx.strokeStyle='#768087';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x+w/2,y+65,12,0,7);ctx.stroke();ctx.lineWidth=1.5;for(let a=-Math.PI/2;a<Math.PI*1.5;a+=Math.PI*2/3){ctx.beginPath();ctx.moveTo(x+w/2,y+65);ctx.lineTo(x+w/2+Math.cos(a)*9,y+65+Math.sin(a)*9);ctx.stroke()}
    pxRect(x+12,y+39,w-24,3,'#4d575c');
  }
  function drawPlayerArm(ax,ay){
    if(playerArmSprite.complete&&playerArmSprite.naturalWidth){
      ctx.save();ctx.imageSmoothingEnabled=false;
      ctx.shadowColor='rgba(0,0,0,.72)';ctx.shadowBlur=0;ctx.shadowOffsetX=2;ctx.shadowOffsetY=3;
      ctx.drawImage(playerArmSprite,Math.round(ax),Math.round(ay));
      ctx.restore();
    }
  }
  function drawParticles(){for(const p of particles){ctx.globalAlpha=clamp(p.life*2,0,1);pxRect(p.x,p.y,4,4,p.c)}ctx.globalAlpha=1}
  function draw(){
    ctx.save();if(shake>0){ctx.translate(rand(-shake,shake),rand(-shake,shake));shake*=.88;if(shake<.5)shake=0}
    drawWorld();roadTraffic.forEach(drawRoadVehicle);traffic.forEach(drawVehicle);drawPlayer();drawParticles();
    // subtle scanlines / vignette
    ctx.globalAlpha=.09;ctx.fillStyle='#000';for(let y=0;y<H;y+=4)ctx.fillRect(0,y,W,1);ctx.globalAlpha=1;
    const g=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.25,W/2,H/2,Math.max(W,H)*.85);g.addColorStop(0,'transparent');g.addColorStop(1,'#02040599');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.restore();
  }
  function loop(now){const dt=Math.min((now-last)/1000,.034);last=now;if(state==='playing')update(dt);else if(state==='over')updateParticles(dt);draw();requestAnimationFrame(loop)}

  document.querySelector('#startBtn').addEventListener('click',start);document.querySelector('#restartBtn').addEventListener('click',start);document.querySelector('#resumeBtn').addEventListener('click',()=>setPause(false));document.querySelector('#pauseBtn').addEventListener('click',()=>state==='paused'?setPause(false):setPause(true));
  document.querySelector('#finishRestartBtn').addEventListener('click',start);
  addEventListener('keydown',e=>{if(['ArrowUp','w','W'].includes(e.key)){keys.up=true;e.preventDefault()}if(['ArrowDown','s','S'].includes(e.key)){keys.down=true;e.preventDefault()}if(['ArrowLeft','a','A'].includes(e.key)){keys.left=true;e.preventDefault()}if(['ArrowRight','d','D'].includes(e.key)){keys.right=true;e.preventDefault()}if(e.key==='p'||e.key==='P'||e.key==='Escape')state==='paused'?setPause(false):setPause(true);if((state==='menu'||state==='over'||state==='finished')&&e.key==='Enter')start()});
  addEventListener('keyup',e=>{if(['ArrowUp','w','W'].includes(e.key))keys.up=false;if(['ArrowDown','s','S'].includes(e.key))keys.down=false;if(['ArrowLeft','a','A'].includes(e.key))keys.left=false;if(['ArrowRight','d','D'].includes(e.key))keys.right=false});
  const trackpad=document.querySelector('#trackpad');
  const trackpadKnob=document.querySelector('#trackpadKnob');
  function moveTrackpad(e){
    if(!touchInput.active||e.pointerId!==touchInput.pointerId)return;
    const bounds=trackpad.getBoundingClientRect();
    const localX=clamp(e.clientX-bounds.left,0,bounds.width-.01);
    const localY=clamp(e.clientY-bounds.top,0,bounds.height-.01);
    const column=Math.floor(localX/(bounds.width/3));
    const row=Math.floor(localY/(bounds.height/3));
    touchInput.x=column-1;
    touchInput.y=row-1;
    const dx=(column-1)*bounds.width/3,dy=(row-1)*bounds.height/3;
    trackpadKnob.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
    e.preventDefault();
  }
  function releaseTrackpad(e){
    if(e&&touchInput.pointerId!==null&&e.pointerId!==touchInput.pointerId)return;
    touchInput.active=false;touchInput.x=0;touchInput.y=0;touchInput.pointerId=null;
    player.steerSpeed=0;
    trackpad.classList.remove('active');
    trackpadKnob.style.transform='translate(-50%,-50%)';
  }
  trackpad.addEventListener('pointerdown',e=>{
    touchInput.active=true;touchInput.pointerId=e.pointerId;
    trackpad.setPointerCapture(e.pointerId);trackpad.classList.add('active');moveTrackpad(e);e.preventDefault();
  });
  trackpad.addEventListener('pointermove',moveTrackpad);
  trackpad.addEventListener('pointerup',releaseTrackpad);
  trackpad.addEventListener('pointercancel',releaseTrackpad);
  addEventListener('orientationchange',()=>setTimeout(()=>location.reload(),180));
  updateHud();updateLight();draw();requestAnimationFrame(t=>{last=t;requestAnimationFrame(loop)});
})();

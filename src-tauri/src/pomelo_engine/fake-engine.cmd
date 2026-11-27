@echo off
rem Test double of pomelo-engine.exe for the Rust tests of src/pomelo_engine (cargo test), never shipped: it prints the
rem contract's lines. "run" reads the operation id from its fifth argument (run --data D --op ID).
if "%1"=="version" (echo {"version":"1.0.0","protocol":1}& exit /b 0)
if "%1"=="catalog" (echo {"ops":[{"id":"image.convert.png","tab":"convert","name":"PNG","kinds":["image"],"extensions":[".jpg",".png"],"output":".png","options":[{"id":"quality","type":"int","label":"Quality","default":80,"min":1,"max":100}],"multi":false,"secret":false}]}& exit /b 0)
if "%1"=="license" (echo {"state":"free","left":17,"daily":2,"email":null,"buy":"https://buy.stripe.com/test_fake","instance_id":"fake-instance","offer":{"price":"4.99","was":"9.99","until":"2026-12-31T23:59:59Z"}}& exit /b 0)
if not "%1"=="run" exit /b 2
if "%5"=="test.locked" (echo {"type":"locked","left":0}& exit /b 3)
if "%5"=="test.secret" goto secret
if "%5"=="test.slow" goto slow
echo starting, not a line of the contract
echo {"type":"start","index":0,"file":"C:\\in\\a.jpg"}
echo {"type":"progress","index":0,"fraction":0.5}
echo {"type":"surprise","index":0}
echo {"type":"done","index":0,"outputs":["C:\\out\\a.png"]}
echo {"type":"allowance","left":16}
echo {"type":"end","ok":1,"failed":0}
exit /b 0
:secret
set /p PW=
if "%PW%"=="hunter2" (echo {"type":"done","index":0,"outputs":[]}) else (echo {"type":"error","index":0,"code":"password","message":"Wrong password"})
exit /b 0
:slow
echo {"type":"start","index":0,"file":"C:\\in\\a.jpg"}
rem A child that holds the output pipe: only ending the whole job lets the reader finish.
ping -n 31 127.0.0.1
echo {"type":"end","ok":1,"failed":0}
exit /b 0

@echo off
rem Test double of Pomelo.exe --hosted for the Rust tests of src/pomelo_engine/wheel.rs (cargo test), never shipped: it prints
rem the wheel's lines. The first argument picks what it does.
if "%1"=="conflict" (echo {"type":"conflict","with":"store"}& exit /b 5)
if "%1"=="hang" goto hang
echo starting, not a line of the contract
echo {"type":"ready"}
echo {"type":"log","text":"listening"}
echo {"type":"locked","left":0}
echo {"type":"open-settings","page":"wheel"}
exit /b 1
:hang
echo {"type":"ready"}
rem A child of its own: only ending the whole job ends it before 30 s.
ping -n 31 127.0.0.1 >nul
exit /b 0

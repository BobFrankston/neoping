cls
set dest=172.20.4.58

call C:\Users\Bob\AppData\Roaming\npm\npmglobalize.cmd
ping %dest% -n 1
neoping.ps1 %dest% -trace -c 1

wsl ping %dest% -c 1
wsl neoping %dest% -trace -c 1

ssh pi4c sudo npm install @bobfrankston/neoping
ssh pi4c ping %dest% -c 1
ssh pi4c neoping %dest% -trace -c 1

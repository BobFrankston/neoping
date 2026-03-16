cls
call C:\Users\Bob\AppData\Roaming\npm\npmglobalize.cmd
ping 172.20.4.58 -n 1
neoping.ps1 172.20.4.58 -trace -c 1
ssh pi4c sudo npm install @bobfrankston/neoping
ssh pi4c ping 172.20.4.58 -c 1
ssh pi4c neoping 172.20.4.58 -trace -c 1

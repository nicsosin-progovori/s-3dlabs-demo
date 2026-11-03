proxy_pass http://172.18.0.6:5180;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 3s;
proxy_send_timeout 35s;
proxy_read_timeout 310s;


#### Start Web Server
To access a demo web app utilizing the parser on backend at http://localhost:4775, run: 
```
(cd pdf-parser && docker build --tag=pdfparser .)
docker run -p 4775:4775 pdfparser 

```





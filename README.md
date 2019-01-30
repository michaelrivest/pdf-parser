
#### Start Web Server
```
(cd pdf-parser && docker build --tag=pdfparser .)
docker run -p 4775:4775 pdfparser 

// access it on http://localhost:4775
```





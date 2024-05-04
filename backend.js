// server.js

const express = require('express');
const mongoose = require('mongoose');
const fileUpload = require('express-fileupload');
const xlsx = require('xlsx');
const cors = require('cors'); // Importe o pacote cors
const bodyParser = require('body-parser');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.json());
app.use(cors());

const { Cliente, Livro, Venda } = require('./models');

mongoose.connect('mongodb://127.0.0.1:27017/lulifeira')
  .then(() => {
    console.log('Conectado ao MongoDB local');
    const server = https.createServer({
      key: fs.readFileSync('./sistemafeira/lulifeirafront/.cert/key.pem'),
      cert: fs.readFileSync('./sistemafeira/lulifeirafront/.cert/cert.pem')
    }, app);
    server.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Erro ao conectar ao MongoDB local:', error);
  });


// Middleware para lidar com o upload de arquivos
app.use(fileUpload());



// Função para agrupar itens duplicados com mesmo ISBN e mesmo valor de venda
function agruparLivrosVendidos(livrosVendidos) {
  const livrosVendidosAgrupados = [];
  const map = new Map();

  livrosVendidos.forEach(livro => {
    const { ISBN, 'Valor Vendido': ValorVendido, ...resto } = livro;
    const chave = `${ISBN}-${ValorVendido}`;
    if (map.has(chave)) {
      const itemExistente = map.get(chave);
      itemExistente.Quantidade += livro.Quantidade;
    } else {
      map.set(chave, { ISBN, 'Valor Vendido': ValorVendido, ...resto });
    }
  });

  for (const item of map.values()) {
    livrosVendidosAgrupados.push(item);
  }

  return livrosVendidosAgrupados;
}




// Rota para upload de arquivo de estoque
app.post('/adicionar-estoque', async (req, res) => {
  if (!req.files || !req.files.estoque) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const estoqueFile = req.files.estoque;

  // Verifica se o arquivo é do tipo Excel
  if (!estoqueFile.mimetype.includes('excel')) {
    return res.status(400).json({ error: 'O arquivo enviado não é um arquivo Excel' });
  }

  try {
    // Lê o arquivo Excel
    const workbook = xlsx.read(estoqueFile.data, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    for (const item of data) {
      // Verifica se o ISBN já está cadastrado no banco de dados
      const existingLivro = await Livro.findOne({ ISBN: item.ISBN });

      if (existingLivro) {
        // Se o ISBN já existir, adicione o estoque ao existente
        existingLivro.Estoque += item.Estoque;
        await existingLivro.save();
      } else {
        // Se o ISBN não existir, crie um novo documento no banco de dados
        await Livro.create(item);
      }
    }

    res.status(200).json({ message: 'Dados do estoque cadastrados com sucesso' });
  } catch (error) {
    console.error('Erro ao cadastrar dados do estoque:', error);
    res.status(500).json({ error: 'Erro ao cadastrar dados do estoque' });
  }
});

app.post('/substituir-estoque', (req, res) => {
  if (!req.files || !req.files.estoque) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const estoqueFile = req.files.estoque;

  // Verifica se o arquivo é do tipo Excel
  if (!estoqueFile.mimetype.includes('excel')) {
    return res.status(400).json({ error: 'O arquivo enviado não é um arquivo Excel' });
  }

  // Lê o arquivo Excel
  const workbook = xlsx.read(estoqueFile.data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);

  // Substitui o conteúdo do estoque pelo novo conteúdo
  Livro.deleteMany({})
    .then(() => {
      Livro.insertMany(data)
        .then(() => {
          res.status(200).json({ message: 'Estoque substituído com sucesso' });
        })
        .catch((error) => {
          console.error('Erro ao cadastrar novo estoque:', error);
          res.status(500).json({ error: 'Erro ao cadastrar novo estoque' });
        });
    })
    .catch((error) => {
      console.error('Erro ao excluir estoque existente:', error);
      res.status(500).json({ error: 'Erro ao excluir estoque existente' });
    });
});

// Rota para obter dados do livro por ISBN
app.get('/livro/:isbn', (req, res) => {
  const isbn = req.params.isbn;

  // Consulta o MongoDB para encontrar o livro com o ISBN fornecido
  Livro.findOne({ ISBN: isbn })
    .then((livro) => {
      if (!livro) {
        return res.status(404).json({ error: 'Livro não encontrado' });
      }

      // Retorna os dados do livro encontrado
      res.status(200).json({ livro });
    })
    .catch((error) => {
      console.error('Erro ao buscar dados do livro:', error);
      res.status(500).json({ error: 'Erro ao buscar dados do livro' });
    });
});

app.post('/salvarcliente', async (req, res) => {
    try {
      // Extrair os dados do corpo da solicitação
      const { nome, cpf, email, telefone, cep, endereco, bairro, cidade, estado } = req.body;
  
      // Verificar se já existe um cliente com o CPF fornecido
      const clienteExistente = await Cliente.findOne({ cpf });
  
      // Se o cliente já existir, retornar o objeto cliente
      if (clienteExistente) {
        return res.status(200).json({ cliente: clienteExistente });
      }
  
      // Criar uma nova instância do modelo Cliente
      const novoCliente = new Cliente({
        nome,
        cpf,
        email,
        telefone,
        cep,
        endereco,
        bairro,
        cidade,
        estado,
      });
  
      // Salvar o cliente no banco de dados
      const clienteSalvo = await novoCliente.save();
  
      // Retornar o objeto cliente recém-salvo
      res.status(201).json({ cliente: clienteSalvo });
    } catch (error) {
      console.error('Erro ao salvar o cliente:', error);
      res.status(500).json({ mensagem: 'Erro ao salvar o cliente' });
    }
});

app.post('/registrar-venda', async (req, res) => {
    try {
        // Extrair todas as informações da solicitação
        const { cliente, livros, total } = req.body;

        // Criar uma nova instância do modelo Venda
        const novaVenda = new Venda({
            cliente,
            livros,
            total
            // Outras informações relevantes da venda, se houver
        });

        // Salvar a venda no banco de dados
        const vendaRegistrada = await novaVenda.save();

        // Atualizar o estoque dos livros vendidos na coleção de Livros
        await Promise.all(livros.map(async (livro) => {
            await Livro.findByIdAndUpdate(livro.livro, { $inc: { Estoque: -livro.quantidade } });
        }));

        // Responder com sucesso
        res.status(200).json({ mensagem: 'Venda registrada com sucesso!', venda: vendaRegistrada });
    } catch (error) {
        console.error('Erro ao registrar a venda:', error);
        res.status(500).json({ mensagem: 'Erro ao registrar a venda' });
    }
});

app.post('/estornar-venda/:id', async (req, res) => {
  try {
    // Extrair o ID da venda a ser estornada dos parâmetros da solicitação
    const vendaId = req.params.id;

    // Buscar a venda pelo ID
    const vendaParaEstornar = await Venda.findById(vendaId);

    // Se a venda não existir, retornar um erro 404
    if (!vendaParaEstornar) {
      return res.status(404).json({ mensagem: 'Venda não encontrada' });
    }

    // Restaurar o estoque dos livros vendidos na coleção de Livros
    await Promise.all(vendaParaEstornar.livros.map(async (livro) => {
      await Livro.findByIdAndUpdate(livro.livro, { $inc: { Estoque: livro.quantidade } });
    }));

    // Remover a venda do banco de dados
    await Venda.findByIdAndDelete(vendaId);

    // Responder com sucesso
    res.status(200).json({ mensagem: 'Venda estornada com sucesso!' });
  } catch (error) {
    console.error('Erro ao estornar a venda:', error);
    res.status(500).json({ mensagem: 'Erro ao estornar a venda' });
  }
});

app.get('/vendas', async (req, res) => {
    try {
      const vendas = await Venda.find();
      res.status(200).json(vendas);
    } catch (error) {
      console.error('Erro ao listar vendas:', error);
      res.status(500).json({ mensagem: 'Erro ao listar vendas' });
    }
  }); 

  app.get('/vendas/:id', async (req, res) => {
    try {
        const venda = await Venda.findById(req.params.id)
            .populate('cliente')
            .populate({
                path: 'livros',
                populate: { path: 'livro' }
            });

        if (!venda) {
            return res.status(404).json({ mensagem: 'Venda não encontrada' });
        }

        // Substituir as referências pelo conteúdo real
        const vendaFormatada = {
            ...venda._doc,
            cliente: venda.cliente,
            livros: venda.livros.map(livro => ({
                ...livro._doc,
                livro: livro.livro
            }))
        };

        res.json(vendaFormatada);
    } catch (error) {
        console.error('Erro ao buscar a venda:', error);
        res.status(500).json({ mensagem: 'Erro ao buscar a venda' });
    }
});

app.put('/vendas/:idCliente/:idVenda', async (req, res) => {
  try {
    // Extrair o ID do cliente e da venda da solicitação
    const { idCliente, idVenda } = req.params;

    // Verificar se a venda existe
    const vendaExistente = await Venda.findById(idVenda);
    if (!vendaExistente) {
      return res.status(404).json({ mensagem: 'Venda não encontrada' });
    }

    // Atualizar o cliente da venda
    vendaExistente.cliente = idCliente;

    // Salvar a venda atualizada no banco de dados
    const vendaAtualizada = await vendaExistente.save();

    // Responder com sucesso e enviar a venda atualizada
    res.status(200).json({ mensagem: 'Cliente relacionado à venda com sucesso', venda: vendaAtualizada });
  } catch (error) {
    console.error('Erro ao relacionar o cliente à venda:', error);
    res.status(500).json({ mensagem: 'Erro ao relacionar o cliente à venda' });
  }
});

app.put('/editarcliente/:id', async (req, res) => {
  try {
    // Extrair o ID do cliente a ser editado dos parâmetros da solicitação
    const clienteId = req.params.id;

    // Extrair os dados atualizados do corpo da solicitação
    const { nome, cpf, email, telefone, cep, endereco, bairro, cidade, estado } = req.body;

    // Procurar o cliente pelo ID
    const clienteExistente = await Cliente.findById(clienteId);

    // Se o cliente não existir, retornar um erro 404
    if (!clienteExistente) {
      return res.status(404).json({ mensagem: 'Cliente não encontrado' });
    }

    // Atualizar os campos do cliente existente
    clienteExistente.nome = nome;
    clienteExistente.cpf = cpf;
    clienteExistente.email = email;
    clienteExistente.telefone = telefone;
    clienteExistente.cep = cep;
    clienteExistente.endereco = endereco;
    clienteExistente.bairro = bairro;
    clienteExistente.cidade = cidade;
    clienteExistente.estado = estado;

    // Salvar as alterações no banco de dados
    const clienteAtualizado = await clienteExistente.save();

    // Retornar o cliente atualizado
    res.status(200).json({ cliente: clienteAtualizado });
  } catch (error) {
    console.error('Erro ao editar o cliente:', error);
    res.status(500).json({ mensagem: 'Erro ao editar o cliente' });
  }
});

app.get('/clientes', async (req, res) => {
  try {
    const clientes = await Cliente.find();
    res.status(200).json(clientes);
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    res.status(500).json({ mensagem: 'Erro ao listar clientes' });
  }
});

app.get('/livros', async (req, res) => {
  const page = parseInt(req.query.page) || 1; // Obtém o número da página da query string, se não especificado, assume 1
  const limit = 100; // Define o número de livros por página
  const query = req.query.q; // Obtém a consulta de pesquisa da query string

  try {
    let filter = {}; // Define um filtro vazio inicial

    if (query) {
      // Se houver uma consulta de pesquisa, cria um filtro para pesquisar em título, autor, editora e ISBN
      filter = {
        $or: [
          { 'Título': { $regex: query, $options: 'i' } }, // Pesquisa insensível a maiúsculas e minúsculas
          { 'Autor': { $regex: query, $options: 'i' } },
          { 'Editora': { $regex: query, $options: 'i' } },
          { 'ISBN': { $regex: query, $options: 'i' } }
        ]
      };
    }

    const count = await Livro.countDocuments(filter); // Obtém o número total de livros correspondentes ao filtro
    const totalPages = Math.ceil(count / limit); // Calcula o número total de páginas
    const skip = (page - 1) * limit; // Calcula o número de documentos a pular

    const livros = await Livro.find(filter).skip(skip).limit(limit); // Busca os livros correspondentes ao filtro e à página atual

    res.json({ livros, totalPages }); // Retorna os livros e o número total de páginas como resposta em formato JSON
  } catch (error) {
    console.error('Erro ao buscar os livros:', error);
    res.status(500).json({ message: 'Erro ao buscar os livros' });
  }
});

app.put('/livros/:id', async (req, res) => {
  const { id } = req.params;
  const { ValorFeira, Estoque } = req.body;

  try {
    const livro = await Livro.findByIdAndUpdate(
      id,
      { $set: { 'Valor Feira': ValorFeira, Estoque: Estoque } },
      { new: true }
    );

    if (!livro) {
      return res.status(404).json({ message: 'Livro não encontrado' });
    }

    res.json(livro); // Retorna o livro atualizado
  } catch (error) {
    console.error('Erro ao atualizar livro:', error);
    res.status(500).json({ message: 'Erro ao atualizar livro' });
  }
});

// Rota para obter estatísticas das vendas dentro de um período de datas
app.post('/relatorio-vendas', async (req, res) => {
  try {
    // Extrair as datas de início e fim do corpo da solicitação
    const { dataInicio, dataFim } = req.body;

    console.log(dataInicio)
    console.log(dataFim)
    

    // Converter as datas para objetos Date
    const dataInicioDate = new Date(dataInicio);
    const dataFimDate = new Date(dataFim);

    // Consultar o banco de dados para obter as estatísticas das vendas dentro do período fornecido
    const relatorioVendas = await Venda.aggregate([
      {
        $match: {
          timestamp: {
            $gte: dataInicioDate,
            $lte: dataFimDate
          }
        }
      },
      {
        $group: {
          _id: null,
          totalVendas: { $sum: 1 },
          totalProdutosVendidos: { $sum: { $sum: "$livros.quantidade" } },
          valorTotalVendas: { $sum: "$total" },
          ticketMedio: { $avg: "$total" }
          // Adicione outras estatísticas desejadas aqui
        }
      }
    ]);

    // Verificar se há dados disponíveis
    if (relatorioVendas.length === 0) {
      return res.status(404).json({ error: 'Nenhuma venda encontrada dentro do período especificado' });
    }

    // Retornar as estatísticas das vendas
    res.json(relatorioVendas[0]); // O resultado do aggregate é um array, então pegamos o primeiro elemento
  } catch (error) {
    console.error('Erro ao gerar o relatório de vendas:', error);
    res.status(500).json({ error: 'Erro ao gerar o relatório de vendas' });
  }
});

app.post('/relatorio-livros-vendidos', async (req, res) => {
  try {
    const { dataInicio, dataFim } = req.body;

    // Converter as datas para objetos Date ajustados para o fuso horário UTC
    const dataInicioTimestamp = new Date(dataInicio);
    const dataFimTimestamp = new Date(dataFim);

    // Consultar o banco de dados para obter todos os livros vendidos no período fornecido
    const vendas = await Venda.find({
      timestamp: {
        $gte: dataInicioTimestamp,
        $lte: dataFimTimestamp
      }
    }).populate('livros.livro');

    const livrosVendidos = [];

    // Iterar sobre as vendas e extrair os dados dos livros vendidos
    vendas.forEach(venda => {
      venda.livros.forEach(item => {
        const livroVendido = {
          ISBN: item.livro.ISBN,
          Título: item.livro['Título'],
          Editora: item.livro.Editora,
          'Valor Vendido': item.subtotal,
          Quantidade: item.quantidade
        };
        livrosVendidos.push(livroVendido);
      });
    });

    res.json(livrosVendidos);
  } catch (error) {
    console.error('Erro ao gerar o relatório de livros vendidos:', error);
    res.status(500).json({ error: 'Erro ao gerar o relatório de livros vendidos' });
  }
});

app.post('/relatorio-livros-vendidos-xlsx', async (req, res) => {
  try {
    const { dataInicio, dataFim } = req.body;

    // Consultar o banco de dados para obter todos os livros vendidos no período fornecido
    const vendas = await Venda.find({
      timestamp: {
        $gte: dataInicio,
        $lte: dataFim
      }
    }).populate('livros.livro');

    // Extrair os dados dos livros vendidos
    const livrosVendidos = [];
    vendas.forEach(venda => {
      venda.livros.forEach(item => {
        const livroVendido = {
          ISBN: item.livro.ISBN,
          Título: item.livro['Título'],
          Editora: item.livro.Editora,
          'Valor Vendido': item.subtotal,
          Quantidade: item.quantidade
        };
        livrosVendidos.push(livroVendido);
      });
    });

    // Verificar e agrupar itens duplicados com mesmo ISBN e mesmo valor de venda
    const livrosVendidosAgrupados = agruparLivrosVendidos(livrosVendidos);

    // Criar uma nova planilha
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(livrosVendidosAgrupados);

    // Adicionar a planilha ao livro
    xlsx.utils.book_append_sheet(wb, ws, 'Livros Vendidos');

    // Salvar o livro em um arquivo
    const fileName = `relatorio_livros_vendidos_${Date.now()}.xlsx`;
    xlsx.writeFile(wb, fileName);

    // Enviar o arquivo xlsx como resposta
    res.download(fileName, fileName, (err) => {
      // Remover o arquivo temporário após o download ser concluído ou ocorrer um erro
      if (err) throw err;
    });
  } catch (error) {
    console.error('Erro ao gerar o relatório de livros vendidos em xlsx:', error);
    res.status(500).json({ error: 'Erro ao gerar o relatório de livros vendidos em xlsx' });
  }
});


  
